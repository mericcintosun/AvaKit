// Sync the template contracts into contracts-ci/src/ so the Foundry harness
// can compile and test them, and enforce the copy-identity invariant: templates
// that ship the same contract must ship byte-identical sources (a fix landing
// in one copy but not the other is exactly the drift this catches).
//
// Usage: node scripts/sync.mjs   (run from contracts-ci/)

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const templates = join(
  repoRoot,
  "packages",
  "create-avalanche-app",
  "templates",
);
const srcOut = resolve(here, "..", "src");

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

if (failed) process.exit(1);
