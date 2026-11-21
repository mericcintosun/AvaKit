// Verify that every bytecode artifact the repo ships is exactly what
// `forge build` produces from its Solidity source — and, with --write,
// regenerate the ones that are not.
//
// The artifacts are generated files that live away from their source: each
// template bundles one (lib/*-artifact.ts) so a scaffolded app can deploy from
// the browser with no Foundry at runtime, Studio deploys the icm-messenger
// contract with `cast`, the website's /new page deploys the nft-mint contract,
// and token-bridge deploys four contracts from lib/ictt-artifacts.json: the
// erc20-token contract as its demo token, and the bridge itself, built from
// ava-labs/icm-contracts. Nothing else guards against a source and the
// bytecode shipped for it silently drifting apart.
//
// Each artifact is compared with a build of the Foundry project that owns its
// source. The repo's own projects carry the compiler settings of
// contracts-ci/foundry.toml (scripts/sync.mjs enforces it), so for them this is
// also the exact compiler output the forge tests run against. The upstream
// contracts are built from their pinned sources and settings in
// contracts-ci/upstream/ (scripts/upstream.mjs fetches and checks the sources).
//
// eerc-token ships no bytecode, but it pins the circuit files its app proves
// with and the commit its deploy script builds contracts from, and the
// verifiers that deploys have to accept those proofs: scripts/eerc-pin.mjs
// checks that pin at the end.
//
// Usage (from contracts-ci/, needs forge, and the network the first time: the
// upstream sources and eerc-token's pin are fetched from GitHub, then cached):
//   node scripts/check-artifacts.mjs                  verify; exit 1 on any drift
//   node scripts/check-artifacts.mjs --write          rewrite what drifted, in place
//   node scripts/check-artifacts.mjs --eerc-circuits  also hash eerc-token's ten
//                                                     circuit files at its pin (55 MB)

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEercPin } from "./eerc-pin.mjs";
import { describePin, materialize, readPin } from "./upstream.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const TEMPLATES = "packages/create-avalanche-app/templates";
const ICTT_ARTIFACTS = `${TEMPLATES}/token-bridge/lib/ictt-artifacts.json`;
const write = process.argv.includes("--write");

// source    the Foundry project whose build is the truth, in this repo
// upstream  instead of `source`: a pinned upstream project, by its directory
//           name in contracts-ci/upstream/
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
// Not a row: eerc-token, which ships no contract of its own (see above).
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
  // demo token, from the same JSON file as the bridge contracts below.
  {
    source: `${TEMPLATES}/erc20-token/contracts`,
    contract: "AvaKitToken",
    file: ICTT_ARTIFACTS,
    entry: "DemoToken",
  },
  // ...and the bridge: ICTT's home and remote contracts and a registry for
  // each chain, compiled from ava-labs/icm-contracts. Their sources are not in
  // this repo (Ecosystem License, not MIT), so they are fetched at the pinned
  // commit and checked file by file; see contracts-ci/upstream/icm-contracts/.
  {
    upstream: "icm-contracts",
    contract: "ERC20TokenHome",
    file: ICTT_ARTIFACTS,
    entry: "ERC20TokenHome",
  },
  {
    upstream: "icm-contracts",
    contract: "ERC20TokenRemote",
    file: ICTT_ARTIFACTS,
    entry: "ERC20TokenRemote",
  },
  {
    upstream: "icm-contracts",
    contract: "TeleporterRegistry",
    file: ICTT_ARTIFACTS,
    entry: "TeleporterRegistry",
  },
];

const ABI_LITERAL = /(export const abi = )(\[[\s\S]*?\])( as const)/;
const bytecodeLiteral = (name) => new RegExp(`(export const ${name} =\\s*")(0x[0-9a-fA-F]*)(")`);
const CAST_SIGNATURE = /export const (\w+_SIG) = "([^"]*)"/g;

// Builds go to a throwaway directory, not to each project's own out/ and
// cache/: a template directory is copied as it stands into every scaffolded
// app, so this check must not leave Foundry output behind in one.
const scratch = mkdtempSync(join(tmpdir(), "avakit-artifacts-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

/** How the project a row is built from is named in output. */
const sourceLabel = ({ source, upstream }) =>
  upstream === undefined ? source : `upstream ${upstream} (${describePin(readPin(upstream))})`;

// Every upstream project a row needs, fetched once into the scratch directory:
// name -> the root to build. Its sources are checked against the pin as they
// are laid out, so a build never reads a file the pin does not name.
const upstreamRoots = new Map();
for (const { upstream } of ARTIFACTS) {
  if (upstream === undefined || upstreamRoots.has(upstream)) continue;
  try {
    upstreamRoots.set(upstream, await materialize(upstream, join(scratch, `upstream-${upstream}`)));
  } catch (error) {
    console.error(
      `UPSTREAM SOURCE: ${upstream}\n  ${error.message}\n` +
        `  The pin is contracts-ci/upstream/${upstream}/sources.json; see scripts/upstream.mjs.`,
    );
    process.exit(1);
  }
}

const builds = new Map(); // project label -> the directory its build output went to

/** `forge build` a row's project (once) and return its contract's build output. */
function build(artifact) {
  const project = sourceLabel(artifact);
  if (!builds.has(project)) {
    const dir = join(scratch, String(builds.size));
    const out = join(dir, "out");
    const root =
      artifact.upstream === undefined
        ? join(repoRoot, artifact.source)
        : upstreamRoots.get(artifact.upstream);
    const args = ["build", "--root", root, "--out", out, "--cache-path", join(dir, "cache")];
    try {
      execFileSync("forge", args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    } catch (error) {
      console.error(
        `BUILD FAIL: ${project}\n${error.stdout ?? ""}${error.stderr ?? error.message}`,
      );
      process.exit(1);
    }
    builds.set(project, out);
  }
  const { contract } = artifact;
  const file = join(builds.get(project), `${contract}.sol`, `${contract}.json`);
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

// The CBOR metadata solc appends to the code: the IPFS hash of a JSON document
// naming the source files, their paths and the compiler settings, then the
// solc version. Not code: the EVM never runs it.
const METADATA = /a264697066735822[0-9a-f]{68}64736f6c6343[0-9a-f]{6}0033/g;
const METADATA_HASH_AT = "a264697066735822".length; // hex digits before the hash

/** Why the shipped bytecode is not the build's, or undefined when it is.
 * Every byte counts; a difference only inside the build's metadata hashes is
 * named as such, since it means the same code from differently named sources
 * (another directory layout, say) rather than other code. */
function bytecodeProblem(shipped, built) {
  const [a, b] = [shipped.toLowerCase(), built.toLowerCase()];
  if (a === b) return undefined;
  if (a.length === b.length) {
    let masked = a;
    for (const { index } of b.matchAll(METADATA)) {
      if (index % 2 !== 0) continue; // not on a byte boundary: code that looks like CBOR
      const at = index + METADATA_HASH_AT;
      masked = masked.slice(0, at) + b.slice(at, at + 68) + masked.slice(at + 68);
    }
    if (masked === b) {
      return "bytecode differs from the build only in its metadata hash (the code is the same)";
    }
  }
  return "bytecode differs from the build";
}

/** `value` with the keys of every object in it sorted. */
function sortedKeys(value) {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedKeys(value[key])]),
  );
}

/** Why the shipped abi is not the build's, or undefined when it is (the same
 * JSON). One that lists the same items in another order, or spells their keys
 * in another order, is named as such: solc and forge write ABIs differently. */
function abiProblem(shipped, built) {
  if (JSON.stringify(shipped) === JSON.stringify(built)) return undefined;
  const items = (abi) => abi.map((item) => JSON.stringify(sortedKeys(item))).sort();
  if (Array.isArray(shipped) && JSON.stringify(items(shipped)) === JSON.stringify(items(built))) {
    return "abi differs from the build only in the order of its items and keys";
  }
  return "abi differs from the build";
}

/** What in the artifact does not match the build (empty when in sync).
 * `stale` marks what --write regenerates; the rest is edited by hand. */
function drift({ bytecode = "bytecode", abi = true, entry }, built, text) {
  const problems = [];
  const stale = (problem) => {
    if (problem !== undefined) problems.push({ text: problem, stale: true });
  };

  if (entry !== undefined) {
    const shipped = parsed(text)?.[entry];
    if (typeof shipped?.bytecode !== "string" || !Array.isArray(shipped.abi)) {
      const shape = `"${entry}": { "abi": [...], "bytecode": "0x..." }`;
      return [{ text: `the file needs to be a JSON object with ${shape}` }];
    }
    stale(bytecodeProblem(shipped.bytecode, built.bytecode.object));
    stale(abiProblem(shipped.abi, built.abi));
    return problems;
  }

  const hex = text.match(bytecodeLiteral(bytecode))?.[2];
  if (hex === undefined) {
    problems.push({ text: `the file needs an \`export const ${bytecode} = "0x..."\`` });
  } else {
    stale(bytecodeProblem(hex, built.bytecode.object));
  }

  if (abi) {
    const literal = text.match(ABI_LITERAL)?.[2];
    if (literal === undefined) {
      problems.push({ text: "the file needs an `export const abi = [...] as const`" });
    } else if (!sameJson(literal, built.abi)) {
      stale(abiProblem(parsed(literal), built.abi));
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

/** The entries of the JSON artifact files that have no row in ARTIFACTS, as
 * `<file> (<entry>)`. */
function unaccounted() {
  const known = new Map(); // file -> the entries a row checks
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
  const built = build(artifact);
  const path = join(repoRoot, artifact.file);
  let text = readFileSync(path, "utf8");
  let problems = drift(artifact, built, text);

  // Only what drifted is rewritten: an artifact that matches its build keeps
  // its bytes, whatever its formatting.
  if (write && problems.some((problem) => problem.stale)) {
    const next = regenerate(artifact, built, text);
    if (next !== text) {
      writeFileSync(path, next);
      text = next;
      console.log(`updated ${label(artifact)}`);
      problems = drift(artifact, built, text);
    }
  }

  if (problems.length === 0) {
    console.log(`ok ${label(artifact)}`);
    continue;
  }
  failed = true;
  const lines = [
    `ARTIFACT DRIFT: ${label(artifact)}`,
    `  source: ${sourceLabel(artifact)} (${artifact.contract})`,
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
// token once went unchecked, and stale, in a file listed as wholly upstream.
for (const entry of unaccounted()) {
  failed = true;
  console.error(
    `UNCHECKED ARTIFACT: ${entry}\n` +
      "  Add the entry to ARTIFACTS in contracts-ci/scripts/check-artifacts.mjs. If it is\n" +
      "  built from source that is not in this repo, pin that source in\n" +
      "  contracts-ci/upstream/ (see scripts/upstream.mjs) and name it in the row.",
  );
}

// eerc-token: the verifiers `npm run deploy:eerc` deploys have to accept the
// proofs its app makes. A pin where they did not shipped once: deploy:eerc
// deployed keys that matched none of the circuits (see scripts/eerc-pin.mjs).
const EERC = "packages/create-avalanche-app/templates/eerc-token (pinned ava-labs/EncryptedERC)";
const eerc = await checkEercPin(repoRoot, { circuits: process.argv.includes("--eerc-circuits") });
if (eerc.problems.length === 0) {
  console.log(`ok ${EERC} @ ${eerc.commit.slice(0, 12)}`);
} else {
  failed = true;
  console.error(
    [
      `EERC PIN DRIFT: ${EERC}`,
      ...eerc.problems.map((problem) => `  - ${problem}`),
      "  The pin is CIRCUIT_COMMIT in lib/eerc-config.ts and COMMIT in scripts/deploy-eerc.mjs.",
    ].join("\n"),
  );
}

if (failed) process.exit(1);
