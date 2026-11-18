// Verify that every bytecode artifact the repo ships is exactly what
// `forge build` produces from Solidity source in this repo — and, with
// --write, regenerate the ones that are not.
//
// The artifacts are generated files that live away from their source: each
// template bundles one (lib/*-artifact.ts) so a scaffolded app can deploy from
// the browser with no Foundry at runtime, Studio deploys the icm-messenger
// contract with `cast`, and the website's /new page deploys the nft-mint
// contract. Nothing else guards against a source and the bytecode shipped for
// it silently drifting apart.
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
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const TEMPLATES = "packages/create-avalanche-app/templates";
const write = process.argv.includes("--write");

// source    the Foundry project whose build is the truth
// contract  the contract in it
// file      the shipped artifact
// bytecode  the constant holding the creation bytecode (default: `bytecode`)
// abi       false when the file ships no `abi`; it then names the functions it
//           calls as cast signatures (`*_SIG`), which are checked instead
// All paths are relative to the repo root.
//
// Out of scope: token-bridge ships official ava-labs/icm-contracts artifacts
// (lib/ictt-artifacts.json) whose sources are not in this repo; eerc-token
// ships no contract of its own.
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
];

const ABI_LITERAL = /(export const abi = )(\[[\s\S]*?\])( as const)/;
const bytecodeLiteral = (name) => new RegExp(`(export const ${name} =\\s*")(0x[0-9a-fA-F]*)(")`);
const CAST_SIGNATURE = /export const (\w+_SIG) = "([^"]*)"/g;

const builds = new Set();

/** `forge build` a project (once) and return one contract's build output. */
function build(source, contract) {
  const root = join(repoRoot, source);
  if (!builds.has(source)) {
    try {
      execFileSync("forge", ["build", "--force", "--root", root], {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      });
    } catch (error) {
      console.error(`BUILD FAIL: ${source}\n${error.stdout ?? ""}${error.stderr ?? error.message}`);
      process.exit(1);
    }
    builds.add(source);
  }
  return JSON.parse(readFileSync(join(root, "out", `${contract}.sol`, `${contract}.json`), "utf8"));
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

/** The artifact's text with its abi + bytecode replaced by the build's. */
function regenerate({ bytecode = "bytecode", abi = true }, built, text) {
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
function drift({ bytecode = "bytecode", abi = true }, built, text) {
  const problems = [];

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
      console.log(`updated ${artifact.file}`);
    }
  }

  const problems = drift(artifact, built, text);
  if (problems.length === 0) {
    console.log(`ok ${artifact.file}`);
    continue;
  }
  failed = true;
  const lines = [
    `ARTIFACT DRIFT: ${artifact.file}`,
    `  source: ${artifact.source} (${artifact.contract})`,
    ...problems.map((problem) => `  - ${problem.text}`),
  ];
  if (problems.some((problem) => problem.stale)) {
    lines.push("  Regenerate: cd contracts-ci && node scripts/check-artifacts.mjs --write");
  }
  console.error(lines.join("\n"));
}

if (failed) process.exit(1);
