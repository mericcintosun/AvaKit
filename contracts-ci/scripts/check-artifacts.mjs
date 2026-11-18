// Verify that every bytecode artifact the repo ships is exactly what
// `forge build` produces from Solidity source in this repo — and, with
// --write, regenerate the ones that are not.
//
// The artifacts are generated files that live away from their source: each
// template bundles one (lib/*-artifact.ts) so a scaffolded app can deploy from
// the browser with no Foundry at runtime, Studio deploys the icm-messenger
// contract with `cast`, the website's /new page deploys the nft-mint contract,
// and token-bridge deploys the erc20-token contract as its demo token (one
// entry of lib/ictt-artifacts.json). Nothing else guards against a source and
// the bytecode shipped for it silently drifting apart.
//
// Each artifact is compared with a build of the Foundry project that owns its
// source. Every one of those projects carries the compiler settings of
// contracts-ci/foundry.toml (scripts/sync.mjs enforces it), so this is also the
// exact compiler output the forge tests run against.
//
// Usage (from contracts-ci/, needs forge):
//   node scripts/check-artifacts.mjs           verify; exit 1 on any drift
//   node scripts/check-artifacts.mjs --write   rewrite abi + bytecode in place

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const TEMPLATES = "packages/create-avalanche-app/templates";
const ICTT_ARTIFACTS = `${TEMPLATES}/token-bridge/lib/ictt-artifacts.json`;
const write = process.argv.includes("--write");

// source    the Foundry project whose build is the truth
// contract  the contract in it
// file      the shipped artifact
// bytecode  the constant holding the creation bytecode (default: `bytecode`)
// abi       false when the file ships no `abi`; it then names the functions it
//           calls as cast signatures (`*_SIG`), which are checked instead
// entry     set when the file is JSON holding several contracts by name
//           (`{ "<entry>": { "abi": [...], "bytecode": "0x..." } }`): the one
//           this row checks. Without it the file is a *-artifact.ts module.
// All paths are relative to the repo root.
//
// Out of scope: the contracts named under UPSTREAM below, which are builds of
// sources that are not in this repo; eerc-token ships no contract of its own.
const ARTIFACTS = [
  {
    source: `${TEMPLATES}/erc20-token/contracts`,
    contract: "AvaKitToken",
    file: `${TEMPLATES}/erc20-token/lib/token-artifact.ts`,
  },
  {
    source: `${TEMPLATES}/l1-launch/contracts`,
    contract: "AvaKitToken",
    file: `${TEMPLATES}/l1-launch/lib/token-artifact.ts`,
  },
  {
    source: `${TEMPLATES}/nft-mint/contracts`,
    contract: "AvaKitNFT",
    file: `${TEMPLATES}/nft-mint/lib/nft-artifact.ts`,
  },
  {
    source: `${TEMPLATES}/token-gated-app/contracts`,
    contract: "AvaKitNFT",
    file: `${TEMPLATES}/token-gated-app/lib/nft-artifact.ts`,
  },
  {
    source: `${TEMPLATES}/icm-messenger/contracts`,
    contract: "AvaKitMessenger",
    file: `${TEMPLATES}/icm-messenger/lib/messenger-artifact.ts`,
  },
  // Studio deploys the icm-messenger contract with `cast`: bytecode only.
  {
    source: `${TEMPLATES}/icm-messenger/contracts`,
    contract: "AvaKitMessenger",
    file: "packages/studio/src/messenger-artifact.ts",
    bytecode: "MESSENGER_BYTECODE",
    abi: false,
  },
  // The website's /new page deploys the contract the nft-mint template ships.
  {
    source: `${TEMPLATES}/nft-mint/contracts`,
    contract: "AvaKitNFT",
    file: "apps/web/lib/nft-artifact.ts",
  },
  // The example app ships its own, simpler AvaKitNFT.
  {
    source: "examples/web3auth-demo/contracts",
    contract: "AvaKitNFT",
    file: "examples/web3auth-demo/lib/nft-artifact.ts",
  },
  // token-bridge deploys the contract the erc20-token template ships as its
  // demo token. It shares a JSON file with three upstream builds (UPSTREAM).
  {
    source: `${TEMPLATES}/erc20-token/contracts`,
    contract: "AvaKitToken",
    file: ICTT_ARTIFACTS,
    entry: "DemoToken",
  },
];

// The entries of a JSON artifact file that are somebody else's builds: there is
// no source in this repo to compare them with, so they are named here instead
// of checked. token-bridge ships the three ICTT contracts as compiled from
// ava-labs/icm-contracts. Every other entry of such a file is ours and needs a
// row in ARTIFACTS.
const UPSTREAM = {
  [ICTT_ARTIFACTS]: ["ERC20TokenHome", "ERC20TokenRemote", "TeleporterRegistry"],
};

const ABI_LITERAL = /(export const abi = )(\[[\s\S]*?\])( as const)/;
const bytecodeLiteral = (name) => new RegExp(`(export const ${name} =\\s*")(0x[0-9a-fA-F]*)(")`);
const CAST_SIGNATURE = /export const (\w+_SIG) = "([^"]*)"/g;

// Builds go to a throwaway directory, not to each project's own out/ and
// cache/: a template directory is copied as it stands into every scaffolded
// app, so this check must not leave Foundry output behind in one.
const scratch = mkdtempSync(join(tmpdir(), "avakit-artifacts-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

const builds = new Map(); // source -> the directory its build output went to

/** `forge build` a project (once) and return one contract's build output. */
function build(source, contract) {
  if (!builds.has(source)) {
    const dir = join(scratch, String(builds.size));
    const out = join(dir, "out");
    const root = join(repoRoot, source);
    const args = ["build", "--root", root, "--out", out, "--cache-path", join(dir, "cache")];
    try {
      execFileSync("forge", args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    } catch (error) {
      console.error(`BUILD FAIL: ${source}\n${error.stdout ?? ""}${error.stderr ?? error.message}`);
      process.exit(1);
    }
    builds.set(source, out);
  }
  const file = join(builds.get(source), `${contract}.sol`, `${contract}.json`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Every way `cast` can name a function of this ABI: `name(inputs)`,
 * `name(inputs)(outputs)` and `constructor(inputs)`. */
function castSignatures(abi) {
  const type = (param) =>
    param.type.startsWith("tuple")
      ? `(${param.components.map(type).join(",")})${param.type.slice("tuple".length)}`
      : param.type;
  const types = (params) => params.map(type).join(",");
  const signatures = new Set();
  for (const item of abi) {
    if (item.type === "constructor") signatures.add(`constructor(${types(item.inputs)})`);
    if (item.type !== "function") continue;
    signatures.add(`${item.name}(${types(item.inputs)})`);
    signatures.add(`${item.name}(${types(item.inputs)})(${types(item.outputs)})`);
  }
  return signatures;
}

/** Whether `literal` is JSON for `value`. Anything that is not JSON at all (a
 * reformatted literal, say) simply counts as different. */
function sameJson(literal, value) {
  try {
    return JSON.stringify(JSON.parse(literal)) === JSON.stringify(value);
  } catch {
    return false;
  }
}

/** The value `text` is JSON for, or undefined when it is not JSON. */
function parsed(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** JSON in the spacing the JSON artifact files are written in (Python's
 * `json.dumps`: `{"a": [1, 2]}`), so a regenerated entry differs from the
 * shipped one only where its content does. */
function spaced(value) {
  if (Array.isArray(value)) return `[${value.map(spaced).join(", ")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const pairs = Object.entries(value).map(
    ([key, item]) => `${JSON.stringify(key)}: ${spaced(item)}`,
  );
  return `{${pairs.join(", ")}}`;
}

/** Where the object held by a top-level key of a JSON object sits in the
 * object's text, as [start, end) offsets. Undefined when the text is not
 * JSON, the key is missing or it holds something other than an object. */
function entrySpan(text, key) {
  if (parsed(text) === undefined) return undefined;
  let depth = 0;
  let start; // where the entry's object begins, once its key is found
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const from = i;
      for (i++; text[i] !== '"'; i++) if (text[i] === "\\") i++;
      // A string at depth 1 that a colon follows is a top-level key.
      const colon = /\s*:\s*/y;
      colon.lastIndex = i + 1;
      if (depth !== 1 || start !== undefined || !colon.test(text)) continue;
      if (JSON.parse(text.slice(from, i + 1)) !== key) continue;
      if (text[colon.lastIndex] !== "{") return undefined;
      start = colon.lastIndex;
    } else if (char === "{" || char === "[") {
      depth++;
    } else if (char === "}" || char === "]") {
      depth--;
      if (start !== undefined && depth === 1) return [start, i + 1];
    }
  }
  return undefined;
}

/** The artifact's text with its abi + bytecode replaced by the build's. In a
 * JSON file only the bytes of the one entry change: the entries beside it are
 * not this script's to rewrite. */
function regenerate({ bytecode = "bytecode", abi = true, entry }, built, text) {
  if (entry !== undefined) {
    const span = entrySpan(text, entry);
    if (!span) return text;
    const fresh = spaced({ abi: built.abi, bytecode: built.bytecode.object });
    return text.slice(0, span[0]) + fresh + text.slice(span[1]);
  }
  let next = text.replace(
    bytecodeLiteral(bytecode),
    (_match, before, _hex, after) => before + built.bytecode.object + after,
  );
  if (abi) {
    next = next.replace(
      ABI_LITERAL,
      (_match, before, _literal, after) => before + JSON.stringify(built.abi, null, 2) + after,
    );
  }
  return next;
}

/** What in the artifact does not match the build (empty when in sync).
 * `stale` marks what --write regenerates; the rest is edited by hand. */
function drift({ bytecode = "bytecode", abi = true, entry }, built, text) {
  const problems = [];

  if (entry !== undefined) {
    const shipped = parsed(text)?.[entry];
    if (typeof shipped?.bytecode !== "string" || !Array.isArray(shipped.abi)) {
      const shape = `"${entry}": { "abi": [...], "bytecode": "0x..." }`;
      return [{ text: `the file needs to be a JSON object with ${shape}` }];
    }
    if (shipped.bytecode.toLowerCase() !== built.bytecode.object.toLowerCase()) {
      problems.push({ text: "bytecode differs from the build", stale: true });
    }
    if (JSON.stringify(shipped.abi) !== JSON.stringify(built.abi)) {
      problems.push({ text: "abi differs from the build", stale: true });
    }
    return problems;
  }

  const hex = text.match(bytecodeLiteral(bytecode))?.[2];
  if (hex === undefined) {
    problems.push({ text: `the file needs an \`export const ${bytecode} = "0x..."\`` });
  } else if (hex.toLowerCase() !== built.bytecode.object.toLowerCase()) {
    problems.push({ text: "bytecode differs from the build", stale: true });
  }

  if (abi) {
    const literal = text.match(ABI_LITERAL)?.[2];
    if (literal === undefined) {
      problems.push({ text: "the file needs an `export const abi = [...] as const`" });
    } else if (!sameJson(literal, built.abi)) {
      problems.push({ text: "abi differs from the build", stale: true });
    }
  } else {
    const known = castSignatures(built.abi);
    for (const [, name, signature] of text.matchAll(CAST_SIGNATURE)) {
      if (!known.has(signature)) {
        problems.push({ text: `${name} "${signature}" is not on the contract: correct it` });
      }
    }
  }

  return problems;
}

/** The artifact files tracked by git (*-artifact.ts modules and
 * *-artifacts.json files) that the list above leaves out. Tracked only: an app
 * scaffolded into the checkout for a quick try carries an artifact of its own,
 * and that is not the repo's to check. */
function unlisted() {
  let files;
  try {
    files = execFileSync("git", ["ls-files", "--", "*-artifact.ts", "*-artifacts.json"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return []; // not a git checkout: nothing to enumerate
  }
  const listed = new Set(ARTIFACTS.map((artifact) => artifact.file));
  return files.split("\n").filter((file) => file !== "" && !listed.has(file));
}

/** The entries of the JSON artifact files that have neither a row in
 * ARTIFACTS nor a place in UPSTREAM, as `<file> (<entry>)`. */
function unaccounted() {
  const known = new Map(); // file -> the entries somebody answers for
  for (const [file, entries] of Object.entries(UPSTREAM)) known.set(file, new Set(entries));
  for (const { file, entry } of ARTIFACTS) {
    if (entry === undefined) continue;
    if (!known.has(file)) known.set(file, new Set());
    known.get(file).add(entry);
  }
  return [...known].flatMap(([file, entries]) =>
    Object.keys(parsed(readFileSync(join(repoRoot, file), "utf8")) ?? {})
      .filter((entry) => !entries.has(entry))
      .map((entry) => `${file} (${entry})`),
  );
}

/** How an artifact is named in the output: its file, and its entry in one. */
const label = ({ file, entry }) => (entry === undefined ? file : `${file} (${entry})`);

let failed = false;

for (const artifact of ARTIFACTS) {
  const built = build(artifact.source, artifact.contract);
  const path = join(repoRoot, artifact.file);
  let text = readFileSync(path, "utf8");

  if (write) {
    const next = regenerate(artifact, built, text);
    if (next !== text) {
      writeFileSync(path, next);
      text = next;
      console.log(`updated ${label(artifact)}`);
    }
  }

  const problems = drift(artifact, built, text);
  if (problems.length === 0) {
    console.log(`ok ${label(artifact)}`);
    continue;
  }
  failed = true;
  const lines = [
    `ARTIFACT DRIFT: ${label(artifact)}`,
    `  source: ${artifact.source} (${artifact.contract})`,
    ...problems.map((problem) => `  - ${problem.text}`),
  ];
  if (problems.some((problem) => problem.stale)) {
    lines.push("  Regenerate: cd contracts-ci && node scripts/check-artifacts.mjs --write");
  }
  console.error(lines.join("\n"));
}

// An artifact nobody checks can go stale without anyone noticing — the website
// once shipped one — so a new one has to be listed before it can land.
for (const file of unlisted()) {
  failed = true;
  console.error(
    `UNCHECKED ARTIFACT: ${file}\n` +
      "  Add it to ARTIFACTS in contracts-ci/scripts/check-artifacts.mjs.",
  );
}

// The same for one contract among several in a JSON file: token-bridge's demo
// token went unchecked, and stale, in a file listed as wholly upstream.
for (const entry of unaccounted()) {
  failed = true;
  console.error(
    `UNCHECKED ARTIFACT: ${entry}\n` +
      "  Add the entry to ARTIFACTS in contracts-ci/scripts/check-artifacts.mjs, or to\n" +
      "  UPSTREAM there if it is built from source that is not in this repo.",
  );
}

if (failed) process.exit(1);
