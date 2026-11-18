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
// is an example app, not a template, so it is deliberately not synced or tested
// here. Its compiler settings and its artifact are checked like the others.
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
 * single-line values here, and anything else is rejected rather than misread.
 *
 * The same goes for everything outside that table that forge would also apply
 * to the default profile. Only the header spelled exactly `[profile.default]`
 * is read; any other table that names the default profile, and any key above
 * the first table, stops the run instead of being skipped. Skipping one is how
 * a file gets reported as pinned while forge compiles it with other settings. */
function compilerSettings(file) {
  const settings = new Map();
  let table; // undefined above the first table header
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = stripComment(raw).trim();
    if (line === "") continue;
    // The lines of a multi-line string are not TOML, but would be read as it.
    if (line.includes('"""') || line.includes("'''")) {
      throw new Error(
        `${file}: \`${line}\` has a multi-line string, which is not read; ` +
          "extend scripts/sync.mjs first",
      );
    }
    if (line.startsWith("[")) {
      if (line === "[profile.default]") {
        table = "profile.default";
        continue;
      }
      const path = tablePath(line);
      if (!path) throw new Error(`${file}: cannot read the table header \`${line}\``);
      if (namesDefaultProfile(path)) {
        throw new Error(
          `${file}: \`${line}\` is not compared: it names the default profile, and ` +
            "[profile.default] is the only table read. Set the option there, or " +
            "extend scripts/sync.mjs first",
        );
      }
      table = path.join(".");
      continue;
    }
    if (table === undefined) {
      throw new Error(
        `${file}: \`${line}\` is not compared: it is above the first table, where forge ` +
          "reads a `default` key as the default profile. Set the option in " +
          "[profile.default], or extend scripts/sync.mjs first",
      );
    }
    if (table !== "profile.default") continue;
    const pair = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!pair) throw new Error(`${file}: cannot read the line \`${raw}\``);
    if (!LAYOUT_KEYS.has(pair[1])) settings.set(pair[1], pair[2]);
  }
  return settings;
}

/** The key of a table header as its parts, in every spelling TOML allows for
 * one: `[a.b]`, the array table `[[a.b]]`, quoted parts (`["a".'b']`) and
 * spaces around the dots all give ["a", "b"]. Undefined when the line is not a
 * header this reader can take apart (an escape inside a quoted part, say). */
function tablePath(line) {
  const key = line.match(/^\[\[(.*)\]\]$/)?.[1] ?? line.match(/^\[(.*)\]$/)?.[1];
  if (key === undefined) return undefined;
  const part = /\s*(?:"([^"\\]*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*(\.|$)/y;
  const path = [];
  while (part.lastIndex < key.length) {
    const match = part.exec(key);
    if (!match) return undefined;
    path.push(match[1] ?? match[2] ?? match[3]);
  }
  return path.length > 0 ? path : undefined;
}

/** Whether a table holds, or can hold, settings of the default profile:
 * `profile.default` and everything under it, `profile` itself (its keys can
 * be `default.<option>`), and `default`, the spelling from before profiles
 * moved under `profile.`, which forge still applies to the default profile. */
function namesDefaultProfile(path) {
  if (path[0] === "default") return true;
  return path[0] === "profile" && (path.length === 1 || path[1] === "default");
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
