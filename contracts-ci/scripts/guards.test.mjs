// Tests for the two guard scripts, scripts/sync.mjs and
// scripts/check-artifacts.mjs. A guard that misses what it exists to catch
// fails silently, so each test runs the real script against a throwaway copy of
// the files it reads, changes one thing in that copy and checks that the script
// notices. The checkout itself is never modified.
//
// Usage (from contracts-ci/, needs forge): node --test scripts/guards.test.mjs

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

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const TEMPLATES = "packages/create-avalanche-app/templates";
const NFT_MINT_CONFIG = `${TEMPLATES}/nft-mint/contracts/foundry.toml`;
const ICTT = `${TEMPLATES}/token-bridge/lib/ictt-artifacts.json`;

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
  for (const template of readdirSync(join(repoRoot, TEMPLATES))) {
    copy(`${TEMPLATES}/${template}/contracts`);
    copy(`${TEMPLATES}/${template}/lib`);
  }
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

// ---- check-artifacts.mjs: the entry of ours in a JSON artifact file ----

test("check-artifacts passes on the repo as it is and checks DemoToken", (t) => {
  const { status, output } = run(fixture(t), "check-artifacts.mjs");
  assert.equal(status, 0, output);
  assert.match(output, new RegExp(`ok ${ICTT} \\(DemoToken\\)`));
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

test("check-artifacts --write keeps the bytes of the upstream entries in any formatting", (t) => {
  const root = fixture(t);
  const shipped = JSON.parse(readFileSync(join(root, ICTT), "utf8"));
  // The whole file without the spaces it ships with, and a stale DemoToken.
  const stale = { ...shipped, DemoToken: { ...shipped.DemoToken, bytecode: "0x00" } };
  const compact = JSON.stringify(stale);
  edit(root, ICTT, () => compact);

  const { status, output } = run(root, "check-artifacts.mjs", "--write");
  assert.equal(status, 0, output);
  const regenerated = readFileSync(join(root, ICTT), "utf8");
  const upstream = compact.slice(0, compact.indexOf('"DemoToken"'));
  assert.ok(regenerated.startsWith(upstream), "the upstream entries were rewritten");
  assert.deepEqual(JSON.parse(regenerated), shipped);
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
