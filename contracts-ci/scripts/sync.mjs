// Sync the template contracts into contracts-ci/src/ so the Foundry harness
// can compile and test them, and enforce the two invariants that make its
// results mean something for what the repo ships:
//
// 1. Copy identity: templates that ship the same contract must ship
//    byte-identical sources (a fix landing in one copy but not the other is
//    exactly the drift this catches).
// 2. One compiler: every foundry.toml that builds a shipped artifact must carry
//    the compiler settings of contracts-ci/foundry.toml. The harness compiles
//    the canonical copy with its own settings while check-artifacts.mjs builds
//    each project with that project's settings, so without this the tested and
//    the shipped bytecode could come from different compilers unnoticed.
//
// Usage: node scripts/sync.mjs   (run from contracts-ci/)

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const templates = join(repoRoot, "packages", "create-avalanche-app", "templates");
const examples = join(repoRoot, "examples");
const srcOut = resolve(here, "..", "src");
const harnessConfig = resolve(here, "..", "foundry.toml");

// canonical: the copy the harness compiles. duplicates: must be byte-identical.
// examples/web3auth-demo ships a different, simpler AvaKitNFT on purpose — it
// is an example app, not a template, and is deliberately not covered here.
const CONTRACTS = [
  {
    name: "AvaKitToken.sol",
    canonical: join(templates, "erc20-token", "contracts", "src"),
    duplicates: [join(templates, "l1-launch", "contracts", "src")],
  },
  {
    name: "AvaKitNFT.sol",
    canonical: join(templates, "nft-mint", "contracts", "src"),
    duplicates: [join(templates, "token-gated-app", "contracts", "src")],
  },
  {
    name: "AvaKitMessenger.sol",
    canonical: join(templates, "icm-messenger", "contracts", "src"),
    duplicates: [],
  },
];

// Where a project keeps its files says nothing about what the compiler emits,
// so these keys may differ between projects. Every other key in
// [profile.default] has to match the harness.
const LAYOUT_KEYS = new Set(["src", "test", "script", "out", "libs", "cache_path"]);

// The harness must spell these out rather than inherit Foundry's defaults,
// which move between releases: both end up in the bytecode's metadata hash.
const REQUIRED_PINS = ["solc_version", "evm_version"];

/** The compiler-relevant `key = value` pairs of a foundry.toml's
 * [profile.default] table. Deliberately tiny: that table holds nothing but
 * single-line values here, and anything else is rejected rather than misread. */
function compilerSettings(file) {
  const settings = new Map();
  let table = "";
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = stripComment(raw).trim();
    if (line === "") continue;
    const header = line.match(/^\[(.+)\]$/);
    if (header) {
      table = header[1].trim();
      continue;
    }
    if (table !== "profile.default") continue;
    const pair = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!pair) throw new Error(`${file}: cannot read the line \`${raw}\``);
    if (!LAYOUT_KEYS.has(pair[1])) settings.set(pair[1], pair[2]);
  }
  return settings;
}

/** Drop a trailing `# comment`, leaving a `#` inside a quoted string alone. */
function stripComment(line) {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Every foundry.toml under `<parent>/<name>/contracts/`. */
function foundryProjects(parent) {
  return readdirSync(parent)
    .map((name) => join(parent, name, "contracts", "foundry.toml"))
    .filter((file) => existsSync(file));
}

mkdirSync(srcOut, { recursive: true });

let failed = false;
for (const { name, canonical, duplicates } of CONTRACTS) {
  const canonicalPath = join(canonical, name);
  const canonicalSource = readFileSync(canonicalPath, "utf8");

  for (const dup of duplicates) {
    const dupPath = join(dup, name);
    if (readFileSync(dupPath, "utf8") !== canonicalSource) {
      failed = true;
      console.error(
        `COPY DRIFT: ${dupPath}\n  differs from ${canonicalPath}\n` +
          `  Templates must ship byte-identical copies of ${name}. ` +
          `Apply the change to both (or extract a shared source).`,
      );
    }
  }

  copyFileSync(canonicalPath, join(srcOut, name));
  console.log(`synced ${name}`);
}

const pinned = compilerSettings(harnessConfig);
for (const key of REQUIRED_PINS) {
  if (!pinned.has(key)) {
    failed = true;
    console.error(`MISSING PIN: contracts-ci/foundry.toml must set ${key} explicitly.`);
  }
}

for (const file of [...foundryProjects(templates), ...foundryProjects(examples)]) {
  const settings = compilerSettings(file);
  const differing = [...new Set([...pinned.keys(), ...settings.keys()])].filter(
    (key) => settings.get(key) !== pinned.get(key),
  );
  if (differing.length === 0) {
    console.log(`pinned ${relative(repoRoot, file)}`);
    continue;
  }
  failed = true;
  console.error(
    `COMPILER DRIFT: ${relative(repoRoot, file)}\n` +
      differing
        .map(
          (key) =>
            `  ${key} = ${settings.get(key) ?? "(unset)"}` +
            `, but contracts-ci/foundry.toml has ${pinned.get(key) ?? "(unset)"}`,
        )
        .join("\n") +
      "\n  Every project must compile with the same settings: change them everywhere," +
      "\n  then regenerate the artifacts (node scripts/check-artifacts.mjs --write).",
  );
}

if (failed) process.exit(1);
