// Deploys the ICTT bridge onto the two local L1s that scripts/bridge.sh created.
//
// On the home chain: a demo ERC-20, a TeleporterRegistry, and an ERC20TokenHome.
// On the remote chain: a TeleporterRegistry and an ERC20TokenRemote, then it
// calls registerWithHome so the remote registers with the home over ICM.
// All addresses are written back into bridge.config.json for the app to read.
//
// Uses viem + the embedded ICTT artifacts (lib/ictt-artifacts.json). Runs with
// the public EWOQ dev key, which is pre-funded on every local chain — read from
// avalanche-cli at run time, never stored in this repo (see deployerAccount).
//
//   node scripts/deploy-bridge.mjs
//   BRIDGE_DEPLOYER_KEY=0x… node scripts/deploy-bridge.mjs   # another funded key

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONFIG = `${ROOT}/bridge.config.json`;
const A = JSON.parse(readFileSync(`${ROOT}/lib/ictt-artifacts.json`, "utf8"));
const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));

// The TeleporterMessenger is the same fixed predeploy on every ICM-enabled L1.
const MESSENGER = "0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf";
const ZERO = "0x0000000000000000000000000000000000000000";
// EWOQ is avalanche-cli's public local dev key; this is its address, which every
// local chain pre-funds. The key itself is deliberately not written in this repo
// — secret scanners flag committed keys, even public dev ones.
const EWOQ_ADDRESS = "0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC";

function fail(message) {
  console.error(message);
  process.exit(1);
}

// The account that deploys the bridge and pays for it on both chains: the EWOQ
// dev key, taken from avalanche-cli, which prints it in `blockchain describe`.
// BRIDGE_DEPLOYER_KEY overrides it with any key that is funded on both chains.
function deployerAccount() {
  const override = process.env.BRIDGE_DEPLOYER_KEY;
  if (override) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(override)) {
      fail("BRIDGE_DEPLOYER_KEY must be a 0x-prefixed 32-byte hex private key.");
    }
    return privateKeyToAccount(override);
  }

  let described;
  try {
    described = execFileSync("avalanche", ["blockchain", "describe", cfg.chain1.name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    fail(
      `Could not run "avalanche blockchain describe ${cfg.chain1.name}" to read the EWOQ dev key.\n` +
        "Is avalanche-cli installed and did `pnpm bridge` create the chains?\n" +
        "Or pass a key that is funded on both chains: BRIDGE_DEPLOYER_KEY=0x… node scripts/deploy-bridge.mjs",
    );
  }
  // Any 64-digit hex string in the output could be a key (a blockchain ID is one
  // too). EWOQ is the one that controls the pre-funded EWOQ address, so a change
  // in the table's layout cannot make this pick the wrong one.
  const candidates = described.match(/(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g) ?? [];
  for (const candidate of new Set(candidates)) {
    try {
      const account = privateKeyToAccount(`0x${candidate}`);
      if (account.address.toLowerCase() === EWOQ_ADDRESS.toLowerCase()) return account;
    } catch {
      // not a valid private key
    }
  }
  fail(
    `avalanche-cli did not print the EWOQ dev key for "${cfg.chain1.name}" (expected in the token ` +
      `allocation table of: avalanche blockchain describe ${cfg.chain1.name}).\n` +
      "Pass a key that is funded on both chains instead: BRIDGE_DEPLOYER_KEY=0x… node scripts/deploy-bridge.mjs",
  );
}
const account = deployerAccount();

function clients(c) {
  const chain = {
    id: c.evmChainId,
    name: c.name,
    nativeCurrency: { name: c.token, symbol: c.token, decimals: 18 },
    rpcUrls: { default: { http: [c.rpcUrl] } },
  };
  return {
    pub: createPublicClient({ chain, transport: http(c.rpcUrl) }),
    wal: createWalletClient({ account, chain, transport: http(c.rpcUrl) }),
  };
}

async function deploy(c, art, args) {
  const hash = await c.wal.deployContract({ abi: art.abi, bytecode: art.bytecode, args, account });
  const r = await c.pub.waitForTransactionReceipt({ hash, timeout: 120000, pollingInterval: 1000 });
  if (r.status !== "success") throw new Error("deploy reverted");
  return r.contractAddress;
}
async function tx(c, params, label) {
  const hash = await c.wal.writeContract({ ...params, account });
  const r = await c.pub.waitForTransactionReceipt({ hash, timeout: 120000, pollingInterval: 1000 });
  console.log(`  ${label}: ${hash} (${r.status})`);
  if (r.status !== "success") throw new Error(`${label} reverted`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const c1 = clients(cfg.chain1);
  const c2 = clients(cfg.chain2);
  const registryArgs = [[{ version: 1n, protocolAddress: MESSENGER }]];

  console.log("Deploying demo ERC-20 on", cfg.chain1.name);
  const demoToken = await deploy(c1, A.DemoToken, []);
  await tx(c1, { address: demoToken, abi: A.DemoToken.abi, functionName: "mint" }, "mint 100 to deployer");

  console.log("Deploying home side on", cfg.chain1.name);
  const registry1 = await deploy(c1, A.TeleporterRegistry, registryArgs);
  const home = await deploy(c1, A.ERC20TokenHome, [registry1, account.address, 1n, demoToken, 18]);

  console.log("Deploying remote side on", cfg.chain2.name);
  const registry2 = await deploy(c2, A.TeleporterRegistry, registryArgs);
  const remote = await deploy(c2, A.ERC20TokenRemote, [
    {
      teleporterRegistryAddress: registry2,
      teleporterManager: account.address,
      minTeleporterVersion: 1n,
      tokenHomeBlockchainID: cfg.chain1.blockchainIdHex,
      tokenHomeAddress: home,
      tokenHomeDecimals: 18,
    },
    `Bridged ${cfg.chain1.token}`,
    `${cfg.chain1.token}.b`,
    18,
  ]);

  console.log("Registering remote with home over ICM");
  await tx(
    c2,
    {
      address: remote,
      abi: A.ERC20TokenRemote.abi,
      functionName: "registerWithHome",
      args: [{ feeTokenAddress: ZERO, amount: 0n }],
    },
    "registerWithHome",
  );

  // registerWithHome only *sends* the ICM message — the bridge is usable once
  // the relayer has delivered it and the home has recorded the remote. Poll
  // the home's own registry instead of guessing with a fixed sleep: a slow
  // relayer would otherwise leave "configured: true" pointing at a bridge
  // whose first transfer fails.
  console.log("Waiting for the relayer to deliver the registration…");
  const deadline = Date.now() + 90000;
  for (;;) {
    const settings = await c1.pub.readContract({
      address: home,
      abi: A.ERC20TokenHome.abi,
      functionName: "getRemoteTokenTransferrerSettings",
      args: [cfg.chain2.blockchainIdHex, remote],
    });
    if (settings.registered) break;
    if (Date.now() > deadline) {
      throw new Error(
        "The home chain has not seen the registration after 90s. " +
          "Check that the relayer is running (pnpm bridge starts it), then " +
          "re-run: node scripts/deploy-bridge.mjs",
      );
    }
    await sleep(2000);
  }
  console.log("  remote registered with home");

  cfg.configured = true;
  cfg.bridge = { demoToken, registry1, home, registry2, remote };
  writeFileSync(CONFIG, `${JSON.stringify(cfg, null, 2)}\n`);
  console.log("\nWrote bridge.config.json:");
  console.log(JSON.stringify(cfg.bridge, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
