// Tests for the two guard scripts, scripts/sync.mjs and
// scripts/check-artifacts.mjs (with scripts/upstream.mjs, which fetches the
// upstream sources it builds, and scripts/eerc-pin.mjs, which checks
// eerc-token's pin). A guard that misses what it exists to catch fails
// silently, so each test runs the real script against a throwaway copy of the
// files it reads, changes one thing in that copy and checks that the script
// notices. The checkout itself is never modified.
//
// Usage (from contracts-ci/, needs forge and, for the upstream files not yet in
// the cache, the network): node --test scripts/guards.test.mjs
// A few tests fetch one file on purpose, to show what a fetch does.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  blobId,
  cacheDir,
  download,
  FetchError,
  importsOf,
  materialize,
  pinnedFile,
  readPin,
  UPSTREAM_DIR,
} from "./upstream.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const TEMPLATES = "packages/create-avalanche-app/templates";
const NFT_MINT_CONFIG = `${TEMPLATES}/nft-mint/contracts/foundry.toml`;
const ICTT = `${TEMPLATES}/token-bridge/lib/ictt-artifacts.json`;
const ICM_PIN = "contracts-ci/upstream/icm-contracts/sources.json";
// Every entry of the ICTT file: the demo token is the repo's own contract, the
// other three are built from the pinned ava-labs/icm-contracts sources.
const ICTT_ENTRIES = ["ERC20TokenHome", "ERC20TokenRemote", "TeleporterRegistry", "DemoToken"];
// eerc-token's pin: the commit of ava-labs/EncryptedERC its app proves with
// and the one its deploy script builds from, and the record of the upstream
// files at that commit that eerc-pin.mjs reads.
const EERC_CONFIG = `${TEMPLATES}/eerc-token/lib/eerc-config.ts`;
const EERC_DEPLOY = `${TEMPLATES}/eerc-token/scripts/deploy-eerc.mjs`;
const EERC_PIN = "contracts-ci/upstream/EncryptedERC/sources.json";
const MINT_VERIFIER = "contracts/prod/MintVerifier.sol";
// The commit eerc-token was pinned to until upstream's fixes of 2026-08-31:
// its deploy script deployed verifiers that match none of the circuits.
const EERC_BEFORE_FIXES = "c7eb0e09bc9315e68c35d3c09f5dce4b794d0485";
// What sources.json records at that commit, where it differs: the blob ids of
// the two files the fixes changed (`git ls-tree c7eb0e09 scripts/deploy-standalone.ts
// test/helpers.ts`). The other files the check reads, the circuit files among
// them, are the same at both commits.
const EERC_BEFORE_FIXES_FILES = {
  "scripts/deploy-standalone.ts": "b28f6ca913bfbcedcb93e825c9a79c5d69a494df",
  "test/helpers.ts": "d885d9312d2f445b1758ff57e37cd01670296fa6",
};

/** Point one or both of eerc-token's pins at `commit`. */
function pinEerc(root, commit, { config = true, deploy = true } = {}) {
  if (config) {
    edit(root, EERC_CONFIG, (text) =>
      text.replace(/const CIRCUIT_COMMIT = "[0-9a-f]{40}";/, `const CIRCUIT_COMMIT = "${commit}";`),
    );
  }
  if (deploy) {
    edit(root, EERC_DEPLOY, (text) =>
      text.replace(/const COMMIT = "[0-9a-f]{40}";/, `const COMMIT = "${commit}";`),
    );
  }
}

/** A temporary upstream cache, removed when the test ends: a copy of the
 * default one, holding every file the pins in contracts-ci/upstream name
 * (fetched into the default cache first where it was not there yet), so that a
 * test can change what is cached and download nothing. */
async function warmCache(t) {
  for (const name of readdirSync(UPSTREAM_DIR)) {
    const pin = readPin(name);
    await Promise.all(Object.keys(pin.files).map((path) => pinnedFile(name, path, pin)));
  }
  const cache = mkdtempSync(join(tmpdir(), "avakit-upstream-cache-"));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  cpSync(cacheDir(), cache, { recursive: true });
  return cache;
}

/** As if upstream had `change`d one of the files eerc-pin.mjs reads at the
 * pinned commit: the fixture's sources.json names the changed copy, which goes
 * into `cache`. Returns the changed copy's blob id. */
function pinEercFile(root, cache, path, change) {
  const pin = JSON.parse(readFileSync(join(root, EERC_PIN), "utf8"));
  const before = readFileSync(join(cache, pin.files[path]), "utf8");
  const after = change(before);
  assert.notEqual(after, before, `the change left ${path} as it was`);
  const id = blobId(Buffer.from(after));
  writeFileSync(join(cache, id), after);
  pin.files[path] = id;
  writeFileSync(join(root, EERC_PIN), `${JSON.stringify(pin, null, 2)}\n`);
  return id;
}

/** One constant of the key a verifier embeds, off by one. */
const offByOne = (source) =>
  source.replace(
    /(uint256 constant IC1x\s*=\s*)(\d+)/,
    (_match, before, value) => `${before}${BigInt(value) + 1n}`,
  );

/** `text` as a regular expression that matches it literally. */
const literally = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// What a working tree may hold beside the sources: none of it is the scripts'
// to read, and a build has to start from the sources alone.
const LEFT_BEHIND = new Set(["node_modules", "out", "cache", "broadcast"]);

/** A copy of everything the two scripts read, laid out as in the repo, in a
 * temporary directory that is removed when the test ends. */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "avakit-guards-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const copy = (path) => {
    if (!existsSync(join(repoRoot, path))) return;
    cpSync(join(repoRoot, path), join(root, path), {
      recursive: true,
      filter: (source) => !LEFT_BEHIND.has(basename(source)),
    });
  };
  copy("contracts-ci/foundry.toml");
  copy("contracts-ci/scripts");
  copy("contracts-ci/upstream");
  for (const template of readdirSync(join(repoRoot, TEMPLATES))) {
    copy(`${TEMPLATES}/${template}/contracts`);
    copy(`${TEMPLATES}/${template}/lib`);
  }
  copy(EERC_DEPLOY);
  copy("examples/web3auth-demo/contracts");
  copy("examples/web3auth-demo/lib");
  copy("packages/studio/src/messenger-artifact.ts");
  copy("apps/web/lib/nft-artifact.ts");
  return root;
}

/** Run one of the scripts in a fixture, the way CI runs it in the repo. */
function run(root, script, ...args) {
  return runWith(root, {}, script, ...args);
}

/** The same, with `env` added to the environment (an upstream cache of the
 * test's own, say). */
function runWith(root, env, script, ...args) {
  const result = spawnSync(
    process.execPath,
    [join(root, "contracts-ci", "scripts", script), ...args],
    { cwd: join(root, "contracts-ci"), encoding: "utf8", env: { ...process.env, ...env } },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** `text` with the hex digit at `index` of `entry`'s bytecode changed, and
 * every other byte of the file as it was. */
function flipBytecodeDigit(text, entry, index) {
  const { bytecode } = JSON.parse(text)[entry];
  const flipped = bytecode[index] === "0" ? "1" : "0";
  const at = text.indexOf(`"${entry}"`);
  return (
    text.slice(0, at) +
    text.slice(at).replace(bytecode, bytecode.slice(0, index) + flipped + bytecode.slice(index + 1))
  );
}

/** Where the IPFS hash of the (first) CBOR metadata block of a bytecode starts,
 * as an index into its hex string. */
function metadataHashAt(bytecode) {
  const at = bytecode.search(/a264697066735822[0-9a-f]{68}64736f6c6343[0-9a-f]{6}0033/);
  assert.ok(at > 0, "the bytecode carries no CBOR metadata");
  return at + "a264697066735822".length;
}

/** Rewrite one file of a fixture. */
function edit(root, path, change) {
  writeFileSync(join(root, path), change(readFileSync(join(root, path), "utf8")));
}

// ---- sync.mjs: one compiler ----

test("sync passes on the repo as it is", (t) => {
  const { status, output } = run(fixture(t), "sync.mjs");
  assert.equal(status, 0, output);
  assert.match(output, new RegExp(`pinned ${NFT_MINT_CONFIG}`));
  assert.match(output, /pinned examples\/web3auth-demo\/contracts\/foundry\.toml/);
});

test("sync reports a compiler setting that differs from the harness", (t) => {
  const root = fixture(t);
  edit(root, NFT_MINT_CONFIG, (toml) =>
    toml.replace('evm_version = "cancun"', 'evm_version = "paris"'),
  );
  const { status, output } = run(root, "sync.mjs");
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`COMPILER DRIFT: ${NFT_MINT_CONFIG}`));
});

// Every spelling below changes what `forge build` compiles with the default
// profile (each was checked against forge 1.7.1, which honours all of them
// but the last) while leaving the keys of the `[profile.default]` table as the
// harness has them. Reading only that table, sync would call the file pinned.
const OVERRIDES_OUTSIDE_THE_TABLE = {
  "an array table of compilation restrictions":
    '\n[[profile.default.compilation_restrictions]]\npaths = "src/**"\nvia_ir = true\n',
  "an array table of additional compiler profiles":
    '\n[[profile.default.additional_compiler_profiles]]\nname = "ir"\nvia_ir = true\n',
  "a sub-table": "\n[profile.default.optimizer_details]\nyul = false\n",
  "a sub-table followed by a comment":
    "\n[profile.default.optimizer_details] # tuned\nyul = false\n",
  "a sub-table with quoted keys": '\n["profile"."default".optimizer_details]\nyul = false\n',
  "a sub-table with a literal-quoted key": "\n[profile.'default'.optimizer_details]\nyul = false\n",
  "a sub-table with spaces around the dots":
    "\n[ profile . default . optimizer_details ]\nyul = false\n",
  "the legacy [default] table": "\n[default]\nvia_ir = true\n",
  "a legacy [default] sub-table": "\n[default.optimizer_details]\nyul = false\n",
  "the [profile] table itself": "\n[profile]\ndefault.via_ir = true\n",
};

for (const [name, toml] of Object.entries(OVERRIDES_OUTSIDE_THE_TABLE)) {
  test(`sync rejects ${name}`, (t) => {
    const root = fixture(t);
    edit(root, NFT_MINT_CONFIG, (config) => config + toml);
    const { status, output } = run(root, "sync.mjs");
    assert.equal(status, 1, output);
    assert.match(output, /nft-mint\/contracts\/foundry\.toml: .* is not compared/);
    assert.doesNotMatch(output, new RegExp(`pinned ${NFT_MINT_CONFIG}`));
  });
}

// forge reads a key above the first table header as a table of its own, so
// `default` there is the legacy spelling of the default profile again.
const KEYS_ABOVE_THE_FIRST_TABLE = {
  "a dotted key": "default.via_ir = true\n",
  "an inline table": "default = { via_ir = true }\n",
};

for (const [name, toml] of Object.entries(KEYS_ABOVE_THE_FIRST_TABLE)) {
  test(`sync rejects ${name} above the first table`, (t) => {
    const root = fixture(t);
    edit(root, NFT_MINT_CONFIG, (config) => toml + config);
    const { status, output } = run(root, "sync.mjs");
    assert.equal(status, 1, output);
    assert.match(output, /nft-mint\/contracts\/foundry\.toml: .* is not compared/);
    assert.doesNotMatch(output, new RegExp(`pinned ${NFT_MINT_CONFIG}`));
  });
}

test("sync rejects a different spelling of the [profile.default] header", (t) => {
  const root = fixture(t);
  edit(root, NFT_MINT_CONFIG, (config) =>
    config.replace("[profile.default]", '["profile"."default"]'),
  );
  const { status, output } = run(root, "sync.mjs");
  assert.equal(status, 1, output);
  assert.match(output, /nft-mint\/contracts\/foundry\.toml: .* is not compared/);
});

test("sync rejects a multi-line string, whose lines would read as a table of pinned keys", (t) => {
  const root = fixture(t);
  // The file really compiles for paris; the string only looks like a second
  // [profile.default] table that puts cancun back.
  edit(
    root,
    NFT_MINT_CONFIG,
    (config) =>
      `${config.replace('evm_version = "cancun"', 'evm_version = "paris"')}` +
      'note = """\n[profile.default]\nevm_version = "cancun"\n[fmt]\n"""\n',
  );
  const { status, output } = run(root, "sync.mjs");
  assert.equal(status, 1, output);
  assert.match(output, /nft-mint\/contracts\/foundry\.toml: .* is not read/);
  assert.doesNotMatch(output, new RegExp(`pinned ${NFT_MINT_CONFIG}`));
});

// ---- check-artifacts.mjs: the entries of token-bridge's JSON artifact file ----

test("check-artifacts passes on the repo as it is and checks every entry of the ICTT file", (t) => {
  const { status, output } = run(fixture(t), "check-artifacts.mjs");
  assert.equal(status, 0, output);
  for (const entry of ICTT_ENTRIES) assert.match(output, new RegExp(`ok ${ICTT} \\(${entry}\\)`));
  assert.match(output, /ok \S+\/eerc-token \(pinned ava-labs\/EncryptedERC\) @ [0-9a-f]{12}\n/);
});

test("check-artifacts catches a stale DemoToken and --write regenerates only that entry", (t) => {
  const root = fixture(t);
  const shipped = readFileSync(join(root, ICTT), "utf8");

  // The stale build this guards against differed from the pinned one in
  // nothing but the metadata hash at the end of the bytecode; the abi goes
  // stale here as well. Edited as text, so the rest of the file keeps its
  // bytes.
  edit(root, ICTT, (text) => {
    const { bytecode } = JSON.parse(text).DemoToken;
    const flipped = bytecode.at(-60) === "0" ? "1" : "0";
    const entry = text.indexOf('"DemoToken"');
    return (
      text.slice(0, entry) +
      text
        .slice(entry)
        .replace(bytecode, bytecode.slice(0, -60) + flipped + bytecode.slice(-59))
        .replace('"allowance"', '"allowanse"')
    );
  });

  const stale = run(root, "check-artifacts.mjs");
  assert.equal(stale.status, 1, stale.output);
  assert.match(stale.output, new RegExp(`ARTIFACT DRIFT: ${ICTT} \\(DemoToken\\)`));
  assert.match(stale.output, /bytecode differs from the build/);
  assert.match(stale.output, /abi differs from the build/);

  const written = run(root, "check-artifacts.mjs", "--write");
  assert.equal(written.status, 0, written.output);
  assert.match(written.output, new RegExp(`updated ${ICTT} \\(DemoToken\\)`));

  // Byte for byte what the repo ships: the entry is back, in the file's own
  // formatting, and the upstream entries beside it were not rewritten.
  assert.equal(readFileSync(join(root, ICTT), "utf8"), shipped);
  assert.equal(run(root, "check-artifacts.mjs").status, 0);
});

test("check-artifacts leaves a file that is in sync untouched under --write", (t) => {
  const root = fixture(t);
  const shipped = readFileSync(join(root, ICTT), "utf8");
  const { status, output } = run(root, "check-artifacts.mjs", "--write");
  assert.equal(status, 0, output);
  assert.doesNotMatch(output, /updated/);
  assert.equal(readFileSync(join(root, ICTT), "utf8"), shipped);
});

test("check-artifacts --write rewrites only the entry that drifted, in any formatting", (t) => {
  const root = fixture(t);
  const shipped = JSON.parse(readFileSync(join(root, ICTT), "utf8"));
  // The whole file without the spaces it ships with, and a stale DemoToken.
  const stale = { ...shipped, DemoToken: { ...shipped.DemoToken, bytecode: "0x00" } };
  const compact = JSON.stringify(stale);
  edit(root, ICTT, () => compact);

  const { status, output } = run(root, "check-artifacts.mjs", "--write");
  assert.equal(status, 0, output);
  assert.match(output, new RegExp(`updated ${ICTT} \\(DemoToken\\)`));
  assert.doesNotMatch(output, new RegExp(`updated ${ICTT} \\((?!DemoToken)`));
  const regenerated = readFileSync(join(root, ICTT), "utf8");
  const inSync = compact.slice(0, compact.indexOf('"DemoToken"'));
  assert.ok(regenerated.startsWith(inSync), "entries that were in sync were rewritten");
  assert.deepEqual(JSON.parse(regenerated), shipped);
});

// The bridge contracts are built from their sources, fetched at the pinned
// commit, and every byte that ships is compared with that build: the code, and
// the metadata hash after it, which names the sources the code was built from.
test("check-artifacts catches one changed byte of an upstream contract, in its code or its metadata", (t) => {
  const root = fixture(t);
  const shipped = readFileSync(join(root, ICTT), "utf8");
  edit(root, ICTT, (text) => {
    const { ERC20TokenHome, TeleporterRegistry } = JSON.parse(text);
    // A byte halfway through ERC20TokenHome, far from its metadata...
    const code = flipBytecodeDigit(text, "ERC20TokenHome", ERC20TokenHome.bytecode.length >> 1);
    // ...and one inside the metadata hash of TeleporterRegistry.
    return flipBytecodeDigit(
      code,
      "TeleporterRegistry",
      metadataHashAt(TeleporterRegistry.bytecode) + 10,
    );
  });

  const stale = run(root, "check-artifacts.mjs");
  assert.equal(stale.status, 1, stale.output);
  const report = (entry) =>
    stale.output.match(new RegExp(`ARTIFACT DRIFT: ${ICTT} \\(${entry}\\)\\n(?:  .*\\n)*`))?.[0];
  const home = report("ERC20TokenHome");
  assert.ok(home, stale.output);
  assert.match(
    home,
    /source: upstream icm-contracts \(ava-labs\/icm-contracts v1\.0\.9 @ dac65983fb95\)/,
  );
  assert.match(home, /- bytecode differs from the build\n/);
  const registry = report("TeleporterRegistry");
  assert.ok(registry, stale.output);
  assert.match(registry, /- bytecode differs from the build only in its metadata hash/);
  for (const entry of ["ERC20TokenRemote", "DemoToken"]) {
    assert.match(stale.output, new RegExp(`ok ${ICTT} \\(${entry}\\)`));
  }

  // --write puts back exactly the bytes the repo ships.
  const written = run(root, "check-artifacts.mjs", "--write");
  assert.equal(written.status, 0, written.output);
  assert.match(written.output, new RegExp(`updated ${ICTT} \\(ERC20TokenHome\\)`));
  assert.match(written.output, new RegExp(`updated ${ICTT} \\(TeleporterRegistry\\)`));
  assert.equal(readFileSync(join(root, ICTT), "utf8"), shipped);
});

test("check-artifacts builds nothing from an upstream source that is not the pinned one", (t) => {
  const root = fixture(t);
  // The pin names a blob GitHub does not have at that path, so the file that
  // comes back is not the one the pin means.
  const file = "contracts/ictt/TokenHome/TokenHome.sol";
  edit(root, ICM_PIN, (text) => {
    const pin = JSON.parse(text);
    pin.files[file] = blobId(Buffer.from("// not the pinned source\n"));
    return `${JSON.stringify(pin, null, 2)}\n`;
  });
  const { status, output } = run(root, "check-artifacts.mjs");
  assert.equal(status, 1, output);
  assert.match(output, /UPSTREAM SOURCE: icm-contracts\n/);
  assert.match(output, new RegExp(`${file}: \\S+/${file} has blob [0-9a-f]{40}, the pin says`));
  assert.doesNotMatch(output, /^ok /m);
});

test("upstream sources are checked in the cache too, and a damaged copy is fetched again", async (t) => {
  // A copy of the warm cache with one source damaged: the one download this
  // makes is that source's.
  const cache = await warmCache(t);
  const layout = mkdtempSync(join(tmpdir(), "avakit-upstream-layout-"));
  const ENV = process.env;
  const previous = ENV.AVAKIT_UPSTREAM_CACHE;
  ENV.AVAKIT_UPSTREAM_CACHE = cache;
  t.after(() => {
    if (previous === undefined) delete ENV.AVAKIT_UPSTREAM_CACHE;
    else ENV.AVAKIT_UPSTREAM_CACHE = previous;
    rmSync(layout, { recursive: true, force: true });
  });

  const file = "contracts/ictt/TokenHome/TokenHome.sol";
  const id = readPin("icm-contracts").files[file];
  writeFileSync(join(cache, id), "// not what the pin says\n");

  await materialize("icm-contracts", layout);
  assert.equal(blobId(readFileSync(join(layout, file))), id, "laid out from a damaged copy");
  assert.equal(blobId(readFileSync(join(cache, id))), id, "the damaged copy is still cached");
});

// ---- check-artifacts.mjs: eerc-token's pin (scripts/eerc-pin.mjs) ----

test("check-artifacts rejects eerc-token's pin from before upstream's 2026-08-31 fixes", (t) => {
  // At that commit `npm run deploy:eerc` deployed the generated verifiers,
  // whose keys match none of the circuit files the app proves with. The
  // fixture is pinned there throughout: both constants, and sources.json as
  // `node scripts/eerc-pin.mjs pin` writes it at that commit.
  const root = fixture(t);
  pinEerc(root, EERC_BEFORE_FIXES);
  edit(root, EERC_PIN, (text) => {
    const pin = JSON.parse(text);
    pin.repositories[0].commit = EERC_BEFORE_FIXES;
    Object.assign(pin.files, EERC_BEFORE_FIXES_FILES);
    return `${JSON.stringify(pin, null, 2)}\n`;
  });
  const { status, output } = run(root, "check-artifacts.mjs");
  assert.equal(status, 1, output);
  assert.match(output, /EERC PIN DRIFT: \S+\/eerc-token \(pinned ava-labs\/EncryptedERC\)\n/);
  assert.match(
    output,
    /deploy-standalone\.ts at c7eb0e09\S* does not deploy the production verifiers/,
  );
  // Everything else is still checked, and fine.
  for (const entry of ICTT_ENTRIES) assert.match(output, new RegExp(`ok ${ICTT} \\(${entry}\\)`));
});

test("eerc-pin rejects an app and a deploy script pinned to different commits", (t) => {
  const root = fixture(t);
  pinEerc(root, EERC_BEFORE_FIXES, { config: false });
  const { status, output } = run(root, "eerc-pin.mjs");
  assert.equal(status, 1, output);
  assert.match(
    output,
    new RegExp(
      `CIRCUIT_COMMIT \\(\\S+\\) is [0-9a-f]{40} but COMMIT \\(\\S+\\) is ${EERC_BEFORE_FIXES}`,
    ),
  );
});

test("eerc-pin rejects a pin that sources.json does not record", (t) => {
  // Both constants moved, without `node scripts/eerc-pin.mjs pin`: the files
  // it would read are another commit's.
  const root = fixture(t);
  pinEerc(root, EERC_BEFORE_FIXES);
  const { status, output } = run(root, "eerc-pin.mjs");
  assert.equal(status, 1, output);
  assert.match(
    output,
    new RegExp(
      `${literally(EERC_PIN)} pins [0-9a-f]{40}, but CIRCUIT_COMMIT is ${EERC_BEFORE_FIXES}: ` +
        "run `node scripts/eerc-pin\\.mjs pin`",
    ),
  );
});

test("eerc-pin checks that each production verifier carries its circuit's key", (t) => {
  const root = fixture(t);
  const { status, output } = run(root, "eerc-pin.mjs");
  assert.equal(status, 0, output);
  for (const name of ["registration", "mint", "transfer", "withdraw", "burn"]) {
    assert.match(
      output,
      new RegExp(`ok ${name}: contracts/prod/\\w+Verifier\\.sol carries the key`),
    );
  }
});

test("eerc-pin rejects a production verifier that does not carry its circuit's key", async (t) => {
  // A verifier with another key rejects every proof the app makes with this
  // circuit's proving key.
  const root = fixture(t);
  const cache = await warmCache(t);
  pinEercFile(root, cache, MINT_VERIFIER, offByOne);
  const { status, output } = runWith(root, { AVAKIT_UPSTREAM_CACHE: cache }, "eerc-pin.mjs");
  assert.equal(status, 1, output);
  assert.match(
    output,
    /EERC PIN DRIFT: contracts\/prod\/MintVerifier\.sol at [0-9a-f]{40} does not carry the key of circom\/build\/mint \(ic differ\)/,
  );
  for (const name of ["registration", "transfer", "withdraw", "burn"]) {
    assert.match(
      output,
      new RegExp(`ok ${name}: contracts/prod/\\w+Verifier\\.sol carries the key`),
    );
  }
});

test("eerc-pin rejects a verification key whose delta is its gamma", async (t) => {
  // A key made without a phase-2 contribution: a verifier with it accepts a
  // forged proof for any statement. The verifier and the JSON key are changed
  // alike, so the one still carries the other.
  const root = fixture(t);
  const cache = await warmCache(t);
  pinEercFile(root, cache, MINT_VERIFIER, (source) => {
    const gamma = new Map(
      [...source.matchAll(/uint256 constant gamma(x1|x2|y1|y2)\s*=\s*(\d+)/g)].map(
        ([, part, value]) => [part, value],
      ),
    );
    assert.equal(gamma.size, 4, "MintVerifier.sol declares no gamma");
    return source.replace(
      /(uint256 constant delta(x1|x2|y1|y2)\s*=\s*)\d+/g,
      (_match, before, part) => `${before}${gamma.get(part)}`,
    );
  });
  pinEercFile(root, cache, "circom/build/mint/mint_verification_key.json", (text) => {
    const key = JSON.parse(text);
    key.vk_delta_2 = key.vk_gamma_2;
    return JSON.stringify(key, null, 1);
  });
  const { status, output } = runWith(root, { AVAKIT_UPSTREAM_CACHE: cache }, "eerc-pin.mjs");
  assert.equal(status, 1, output);
  assert.match(output, /EERC PIN DRIFT: the mint key at [0-9a-f]{40} has delta = gamma/);
  assert.doesNotMatch(output, /does not carry the key/);
});

test("eerc-pin reads deploy-standalone.ts's code, not its comments", async (t) => {
  // The verifiers deployed some other way, and the production call left in a
  // comment; or a second call, which deploys the generated ones.
  const other = "await deployGeneratedVerifiers(deployer);";
  const variants = {
    "the production call only in a line comment": (script) =>
      script.replace(
        "await deployVerifiers(deployer, true);",
        `${other}\n\t// await deployVerifiers(deployer, true);`,
      ),
    "the production call only in a block comment": (script) =>
      script.replace(
        "await deployVerifiers(deployer, true);",
        `${other} /* await deployVerifiers(deployer, true); */`,
      ),
    "a second call that deploys the generated verifiers": (script) =>
      script.replace(
        "await deployVerifiers(deployer, true);",
        "await deployVerifiers(deployer, true);\n\tawait deployVerifiers(deployer, false);",
      ),
  };
  const cache = await warmCache(t);
  for (const [name, change] of Object.entries(variants)) {
    const root = fixture(t);
    pinEercFile(root, cache, "scripts/deploy-standalone.ts", change);
    const { status, output } = runWith(root, { AVAKIT_UPSTREAM_CACHE: cache }, "eerc-pin.mjs");
    assert.equal(status, 1, `${name}:\n${output}`);
    assert.match(
      output,
      /deploy-standalone\.ts at [0-9a-f]{40} does not deploy the production verifiers/,
      name,
    );
  }
});

test("eerc-pin reads no cached copy that is not the pinned file", async (t) => {
  // The fixture's pin names a verifier with a wrong key, and the cache holds,
  // under that verifier's blob id, upstream's verifier, which would pass. The
  // cached copy is refused and the file fetched, and GitHub's copy is not the
  // pinned one either: the one download this test makes.
  const root = fixture(t);
  const cache = await warmCache(t);
  const upstream = JSON.parse(readFileSync(join(root, EERC_PIN), "utf8")).files[MINT_VERIFIER];
  const pinned = pinEercFile(root, cache, MINT_VERIFIER, offByOne);
  copyFileSync(join(cache, upstream), join(cache, pinned));
  const { status, output } = runWith(root, { AVAKIT_UPSTREAM_CACHE: cache }, "eerc-pin.mjs");
  assert.equal(status, 1, output);
  assert.match(
    output,
    new RegExp(
      `EERC PIN DRIFT: ${literally(MINT_VERIFIER)}: \\S+/${literally(MINT_VERIFIER)} ` +
        `has blob ${upstream}, the pin says ${pinned}`,
    ),
  );
  assert.doesNotMatch(output, /ok eerc-token pin/);
});

test("eerc-pin rejects a circuit hash that is not the hash of the file at the pin", (t) => {
  // What a pin moved without new hashes looks like: the hash the app checks a
  // file against is not the one sources.json took from that file.
  const root = fixture(t);
  const zkey = 'path: "mint/mint.zkey", sha256: "';
  edit(root, EERC_CONFIG, (text) => {
    const at = text.indexOf(zkey) + zkey.length;
    assert.ok(at >= zkey.length, `${EERC_CONFIG} pins no mint/mint.zkey`);
    return `${text.slice(0, at)}${text[at] === "0" ? "1" : "0"}${text.slice(at + 1)}`;
  });
  const { status, output } = run(root, "eerc-pin.mjs");
  assert.equal(status, 1, output);
  assert.match(
    output,
    /EERC PIN DRIFT: \S+eerc-config\.ts pins sha256 [0-9a-f]{64} for mint\/mint\.zkey, but circom\/build\/mint\/mint\.zkey at [0-9a-f]{40} has [0-9a-f]{64}/,
  );
});

test("check-artifacts reports an eerc-token file it could not fetch as such, not as drift", async (t) => {
  // None of the files eerc-pin reads is cached, and the repository they would
  // come from does not exist: the download fails, and what needed it is not
  // compared.
  const root = fixture(t);
  const cache = await warmCache(t);
  for (const id of Object.values(readPin("EncryptedERC").files)) rmSync(join(cache, id));
  edit(root, EERC_PIN, (text) =>
    text.replace(
      '"repository": "ava-labs/EncryptedERC"',
      '"repository": "ava-labs/avakit-guards-no-such-repository"',
    ),
  );
  const { status, output } = runWith(root, { AVAKIT_UPSTREAM_CACHE: cache }, "check-artifacts.mjs");
  assert.equal(status, 1, output);
  assert.match(
    output,
    /EERC PIN: could not fetch https:\/\/raw\.githubusercontent\.com\/ava-labs\/avakit-guards-no-such-repository\/[0-9a-f]{40}\/\S+ \(/,
  );
  assert.match(output, /eerc-token's pin was not fully checked/);
  assert.doesNotMatch(output, /EERC PIN DRIFT/);
  // The rest was checked as usual, from the cache.
  for (const entry of ICTT_ENTRIES) assert.match(output, new RegExp(`ok ${ICTT} \\(${entry}\\)`));
});

// ---- upstream.mjs: downloads ----

/** Make fetch answer with `answers` in turn (a Response, or an Error to throw)
 * for the rest of the test, and return the requests it gets. */
function answer(t, ...answers) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url: String(url), authorization: init?.headers?.authorization });
    const next = answers.shift();
    if (next === undefined) throw new Error("more requests than answers");
    if (next instanceof Error) throw next;
    return next;
  });
  return requests;
}

/** What fetch throws when the connection drops. */
const dropped = () =>
  Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });

/** A sleep that records how long it was asked to wait and does not. */
function waits() {
  const asked = [];
  return { asked, sleep: async (seconds) => asked.push(seconds) };
}

const SOME_FILE = "https://raw.githubusercontent.com/owner/repository/commit/file";

test("download retries a dropped connection and a server error, waiting longer each time", async (t) => {
  const requests = answer(t, dropped(), new Response("busy", { status: 502 }), new Response("ok"));
  const { asked, sleep } = waits();
  assert.equal((await download(SOME_FILE, { sleep })).toString(), "ok");
  assert.equal(requests.length, 3);
  assert.deepEqual(asked, [1, 2]);
});

test("download waits as long as Retry-After asks", async (t) => {
  answer(t, new Response("", { status: 429, headers: { "retry-after": "7" } }), new Response("ok"));
  const { asked, sleep } = waits();
  assert.equal((await download(SOME_FILE, { sleep })).toString(), "ok");
  assert.deepEqual(asked, [7]);
});

test("download gives up at once when Retry-After asks for longer than a minute", async (t) => {
  answer(t, new Response("", { status: 429, headers: { "retry-after": "3600" } }));
  const { asked, sleep } = waits();
  await assert.rejects(download(SOME_FILE, { sleep }), (error) => {
    assert.ok(error instanceof FetchError);
    assert.match(error.message, /\(HTTP 429, asked to retry after 3600 s\)$/);
    return true;
  });
  assert.deepEqual(asked, []);
});

test("download gives up at once on a 404", async (t) => {
  const requests = answer(t, new Response("Not Found", { status: 404 }));
  const { asked, sleep } = waits();
  await assert.rejects(download(SOME_FILE, { sleep }), (error) => {
    assert.ok(error instanceof FetchError);
    assert.equal(error.message, `could not fetch ${SOME_FILE} (HTTP 404)`);
    return true;
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(asked, []);
});

test("download gives up after six tries on a server that stays down", async (t) => {
  const busy = Array.from({ length: 6 }, () => new Response("", { status: 503 }));
  const requests = answer(t, ...busy);
  const { asked, sleep } = waits();
  await assert.rejects(download(SOME_FILE, { sleep }), (error) => {
    assert.ok(error instanceof FetchError);
    assert.match(error.message, /\(HTTP 503, 6 attempts\)$/);
    return true;
  });
  assert.equal(requests.length, 6);
  assert.deepEqual(asked, [1, 2, 4, 8, 16]);
});

test("download sends GITHUB_TOKEN to GitHub only, and drops a token GitHub refuses", async (t) => {
  const ENV = process.env;
  const previous = { GITHUB_TOKEN: ENV.GITHUB_TOKEN, GH_TOKEN: ENV.GH_TOKEN };
  ENV.GITHUB_TOKEN = "test-token";
  delete ENV.GH_TOKEN;
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete ENV[name];
      else ENV[name] = value;
    }
  });
  const requests = answer(
    t,
    new Response("", { status: 404 }), // GitHub refuses the token: a public file answers 404
    new Response("public"), // the same request without it
    new Response("elsewhere"), // a host that is not GitHub's
  );
  const { sleep } = waits();
  assert.equal((await download(SOME_FILE, { sleep })).toString(), "public");
  assert.equal((await download("https://example.com/file", { sleep })).toString(), "elsewhere");
  assert.deepEqual(
    requests.map(({ authorization }) => authorization),
    ["Bearer test-token", undefined, undefined],
  );
});

test("upstream.mjs names files by git's blob id and finds every form of import", () => {
  // `git hash-object` of an empty file and of "hello\n".
  assert.equal(blobId(Buffer.from("")), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  assert.equal(blobId(Buffer.from("hello\n")), "ce013625030ba8dba906f756967f9e9ca394464a");
  const source = [
    'import "./A.sol";',
    'import "@x/B.sol" as B;',
    'import * as C from "../C.sol";',
    "import {D, E} from",
    '    "@y/DE.sol";',
    '// import "./commented.sol";',
    '/* import "./block.sol"; */',
    "contract F {}",
  ].join("\n");
  assert.deepEqual(importsOf(source), ["./A.sol", "@x/B.sol", "../C.sol", "@y/DE.sol"]);
});

test("check-artifacts reports a missing DemoToken entry", (t) => {
  const root = fixture(t);
  edit(root, ICTT, (text) => {
    const { DemoToken: _removed, ...rest } = JSON.parse(text);
    return JSON.stringify(rest);
  });
  const { status, output } = run(root, "check-artifacts.mjs");
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`ARTIFACT DRIFT: ${ICTT} \\(DemoToken\\)`));
});

test("check-artifacts rejects an entry nobody accounts for", (t) => {
  const root = fixture(t);
  edit(root, ICTT, (text) => {
    const artifacts = JSON.parse(text);
    return JSON.stringify({ ...artifacts, AnotherToken: artifacts.DemoToken });
  });
  const { status, output } = run(root, "check-artifacts.mjs");
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`UNCHECKED ARTIFACT: ${ICTT} \\(AnotherToken\\)`));
});

test("check-artifacts rejects a tracked artifact file it has not been told about", (t) => {
  const root = fixture(t);
  // The script asks git which artifact files the repo tracks, so the fixture
  // becomes a repository of its own with one more of each kind staged.
  const unlisted = [
    "packages/extra/lib/extra-artifacts.json",
    "packages/extra/lib/extra-artifact.ts",
  ];
  mkdirSync(join(root, "packages/extra/lib"), { recursive: true });
  for (const file of unlisted) writeFileSync(join(root, file), "");
  for (const args of [
    ["init", "--quiet"],
    ["add", "--all"],
  ]) {
    const git = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(git.status, 0, git.stderr);
  }

  const { status, output } = run(root, "check-artifacts.mjs");
  assert.equal(status, 1, output);
  for (const file of unlisted) assert.match(output, new RegExp(`UNCHECKED ARTIFACT: ${file}\\n`));
  assert.doesNotMatch(output, new RegExp(`UNCHECKED ARTIFACT: ${ICTT}`));
});
