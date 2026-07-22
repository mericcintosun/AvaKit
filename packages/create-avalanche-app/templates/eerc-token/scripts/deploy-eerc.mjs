// Deploy YOUR OWN standalone eERC instance to Fuji and point this app at it.
//
//   DEPLOYER_PRIVATE_KEY=0x... pnpm deploy:eerc
//
// Why this exists: the template ships pointed at a shared demo instance whose
// `privateMint` is owner-only (by design, for compliance) — so minting only
// works against an instance YOU deployed. The eERC contracts are deliberately
// NOT vendored in this repo (Ava Labs Ecosystem License, not MIT); this script
// clones the official ava-labs/EncryptedERC repo into a per-commit cache in
// your home directory — pinned to the SAME commit the circuit files in
// lib/eerc-config.ts are served from — and runs its own deploy script.
//
// The private key stays in your shell environment. It is never written to
// disk and never passed as a command-line argument (the patched hardhat
// config reads it from process.env).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Must match CIRCUIT_COMMIT in lib/eerc-config.ts: the contracts you deploy
// and the circuits the browser proves against have to be the same version.
const COMMIT = "c7eb0e09bc9315e68c35d3c09f5dce4b794d0485";
const REPO = "https://github.com/ava-labs/EncryptedERC.git";
const FUJI_RPC = "https://api.avax-test.network/ext/bc/C/rpc";

const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error(
    "\nDEPLOYER_PRIVATE_KEY is not set (or is not a 0x-prefixed 32-byte hex key).\n\n" +
      "Use a throwaway key funded with Fuji test AVAX\n" +
      "(faucet: https://core.app/tools/testnet-faucet), then:\n\n" +
      "  DEPLOYER_PRIVATE_KEY=0x... pnpm deploy:eerc\n\n" +
      "The key stays in your shell environment — it is never written to disk.\n",
  );
  process.exit(1);
}

const appDir = resolveAppDir();
const cacheDir = join(homedir(), ".avakit", `eerc-src-${COMMIT.slice(0, 12)}`);
// npm/npx are .cmd shims on Windows; execFileSync needs a shell for those.
const shell = process.platform === "win32";

function resolveAppDir() {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", shell: cmd !== "git" && shell, ...opts });
}

// [1/4] Clone the official repo, pinned (cached per commit, reused on re-runs).
if (existsSync(join(cacheDir, "package.json"))) {
  console.log(`\n[1/4] Using cached clone: ${cacheDir}`);
} else {
  console.log(`\n[1/4] Cloning ava-labs/EncryptedERC @ ${COMMIT.slice(0, 12)}…`);
  mkdirSync(dirname(cacheDir), { recursive: true });
  run("git", ["clone", REPO, cacheDir]);
  run("git", ["-C", cacheDir, "checkout", COMMIT]);
}

// [2/4] Install + compile. Circuits are pre-built in the repo (circom/build),
// so no trusted setup runs here; --ignore-scripts skips postinstall hooks.
console.log("\n[2/4] Installing deps + compiling contracts (first run takes a while)…");
if (!existsSync(join(cacheDir, "node_modules"))) {
  run("npm", ["install", "--ignore-scripts"], { cwd: cacheDir });
}

// The pinned hardhat config has no public-network entries — add Fuji once.
// The key is read from process.env at hardhat runtime, not inlined here.
const hardhatConfig = join(cacheDir, "hardhat.config.ts");
const config = readFileSync(hardhatConfig, "utf8");
if (!config.includes("fuji:")) {
  writeFileSync(
    hardhatConfig,
    config.replace(
      "  networks: {",
      `  networks: {
    fuji: {
      url: "${FUJI_RPC}",
      chainId: 43113,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },`,
    ),
  );
}

run("npx", ["hardhat", "compile"], { cwd: cacheDir });

// [3/4] Deploy: verifiers + BabyJubJub + Registrar + standalone EncryptedERC.
console.log("\n[3/4] Deploying your standalone eERC to Fuji…");
const out = execFileSync(
  "npx",
  ["hardhat", "run", "scripts/deploy-standalone.ts", "--network", "fuji"],
  { cwd: cacheDir, encoding: "utf8", shell, env: process.env },
);
process.stdout.write(out);

// deploy-standalone.ts prints a console.table; the encryptedERC row holds the
// address this app needs.
const match = out.match(/encryptedERC[^0]*?(0x[0-9a-fA-F]{40})/);
if (!match) {
  console.error(
    "\nDeploy ran, but the encryptedERC address was not found in the output " +
      "above — update lib/eerc-config.ts manually.",
  );
  process.exit(1);
}
const address = match[1];

// [4/4] Point the app at YOUR instance.
const eercConfig = join(appDir, "lib", "eerc-config.ts");
const lib = readFileSync(eercConfig, "utf8");
writeFileSync(
  eercConfig,
  lib.replace(/export const EERC_CONTRACT_ADDRESS: Hex = "0x[0-9a-fA-F]{40}";/, `export const EERC_CONTRACT_ADDRESS: Hex = "${address}";`),
);

console.log(
  `\n[4/4] Done — lib/eerc-config.ts now points at YOUR instance:\n  ${address}\n\n` +
    "Next, run the app (pnpm dev) and connect the DEPLOYER wallet:\n" +
    "  1. Register (one-time, on-chain)\n" +
    "  2. Set auditor (one click — the app shows it to the owner until it's set)\n" +
    "  3. Mint privately — now works, because you are the owner\n",
);
