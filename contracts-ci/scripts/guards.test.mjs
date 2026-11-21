// Tests for the two guard scripts, scripts/sync.mjs and
// scripts/check-artifacts.mjs (with scripts/upstream.mjs, which fetches the
// upstream sources it builds). A guard that misses what it exists to catch
// fails silently, so each test runs the real script against a throwaway copy of
// the files it reads, changes one thing in that copy and checks that the script
// notices. The checkout itself is never modified.
//
// Usage (from contracts-ci/, needs forge and, for the upstream sources not yet
// in the cache, the network): node --test scripts/guards.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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
import { blobId, importsOf, materialize, readPin } from "./upstream.mjs";

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
// and the one its deploy script builds from.
const EERC_CONFIG = `${TEMPLATES}/eerc-token/lib/eerc-config.ts`;
const EERC_DEPLOY = `${TEMPLATES}/eerc-token/scripts/deploy-eerc.mjs`;
// The commit eerc-token was pinned to until upstream's fixes of 2026-08-31:
// its deploy script deployed verifiers that match none of the circuits.
const EERC_BEFORE_FIXES = "c7eb0e09bc9315e68c35d3c09f5dce4b794d0485";

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
  const result = spawnSync(
    process.execPath,
    [join(root, "contracts-ci", "scripts", script), ...args],
    { cwd: join(root, "contracts-ci"), encoding: "utf8" },
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
  const cache = mkdtempSync(join(tmpdir(), "avakit-upstream-cache-"));
  const layouts = mkdtempSync(join(tmpdir(), "avakit-upstream-layout-"));
  const ENV = process.env;
  const previous = ENV.AVAKIT_UPSTREAM_CACHE;
  ENV.AVAKIT_UPSTREAM_CACHE = cache;
  t.after(() => {
    if (previous === undefined) delete ENV.AVAKIT_UPSTREAM_CACHE;
    else ENV.AVAKIT_UPSTREAM_CACHE = previous;
    for (const dir of [cache, layouts]) rmSync(dir, { recursive: true, force: true });
  });

  const file = "contracts/ictt/TokenHome/TokenHome.sol";
  const id = readPin("icm-contracts").files[file];
  await materialize("icm-contracts", join(layouts, "first"));
  writeFileSync(join(cache, id), "// not what the pin says\n");

  const second = await materialize("icm-contracts", join(layouts, "second"));
  assert.equal(blobId(readFileSync(join(second, file))), id, "laid out from a damaged copy");
  assert.equal(blobId(readFileSync(join(cache, id))), id, "the damaged copy is still cached");
});

// ---- check-artifacts.mjs: eerc-token's pin (scripts/eerc-pin.mjs) ----

test("check-artifacts rejects eerc-token's pin from before upstream's 2026-08-31 fixes", (t) => {
  // At that commit `npm run deploy:eerc` deployed the generated verifiers,
  // whose keys match none of the circuit files the app proves with.
  const root = fixture(t);
  pinEerc(root, EERC_BEFORE_FIXES);
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
