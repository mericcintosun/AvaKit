// Verify that each template's shipped lib/*-artifact.ts (abi + bytecode)
// matches what `forge build` produces from that template's own contracts/
// directory with the pinned solc. The artifacts are hand-copied after edits
// (see each template's CLAUDE.md), so nothing else guards against the source
// and the shipped bytecode silently drifting apart.
//
// Builds run inside each template (not the harness): solc embeds a source-path
// hash in the bytecode's CBOR metadata tail, so byte-for-byte parity is only
// meaningful against a build from the template's own directory.
//
// Usage: node scripts/check-artifacts.mjs   (run from contracts-ci/; needs forge)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const templates = resolve(here, "..", "..", "packages", "create-avalanche-app", "templates");

// Out of scope: token-bridge ships official ava-labs/icm-contracts artifacts
// (ictt-artifacts.json) whose sources are not in this repo; eerc-token ships
// no contract of its own.
const CHECKS = [
  { template: "erc20-token", contract: "AvaKitToken", artifact: "token-artifact.ts" },
  { template: "l1-launch", contract: "AvaKitToken", artifact: "token-artifact.ts" },
  { template: "nft-mint", contract: "AvaKitNFT", artifact: "nft-artifact.ts" },
  { template: "token-gated-app", contract: "AvaKitNFT", artifact: "nft-artifact.ts" },
  { template: "icm-messenger", contract: "AvaKitMessenger", artifact: "messenger-artifact.ts" },
];

let failed = false;

for (const { template, contract, artifact } of CHECKS) {
  const root = join(templates, template, "contracts");
  execFileSync("forge", ["build", "--force", "--root", root], {
    stdio: "pipe",
  });

  const built = JSON.parse(
    readFileSync(join(root, "out", `${contract}.sol`, `${contract}.json`), "utf8"),
  );
  const ts = readFileSync(join(templates, template, "lib", artifact), "utf8");

  const abiMatch = ts.match(/export const abi = (\[[\s\S]*?\]) as const/);
  const bytecodeMatch = ts.match(/export const bytecode = "(0x[0-9a-fA-F]*)"/);
  if (!abiMatch || !bytecodeMatch) {
    failed = true;
    console.error(
      `PARSE FAIL: ${template}/lib/${artifact} — expected ` +
        '`export const abi = [...] as const` and `export const bytecode = "0x..."`',
    );
    continue;
  }

  const abiOk = JSON.stringify(JSON.parse(abiMatch[1])) === JSON.stringify(built.abi);
  const bytecodeOk = bytecodeMatch[1].toLowerCase() === built.bytecode.object.toLowerCase();

  if (!abiOk || !bytecodeOk) {
    failed = true;
    console.error(
      `ARTIFACT DRIFT: ${template} (${contract}) — ` +
        `${abiOk ? "" : "abi "}${bytecodeOk ? "" : "bytecode "}mismatch\n` +
        `  Regenerate: cd packages/create-avalanche-app/templates/${template}/contracts` +
        ` && forge build,\n  then copy out/${contract}.sol/${contract}.json's` +
        ` abi + bytecode.object into lib/${artifact}.`,
    );
  } else {
    console.log(`ok ${template} (${contract})`);
  }
}

if (failed) process.exit(1);
