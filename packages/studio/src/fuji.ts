/**
 * Fuji L1 launch — the "graduate your L1 to the public testnet" flow, driven
 * step by step from the Studio UI instead of avalanche-cli's interactive prompts.
 *
 * Same security posture as devnet.ts: spawn avalanche-cli with FIXED argument
 * arrays (never a shell string); the only request-derived values are the L1
 * name / chain id / token / amount, each strictly whitelist-validated before it
 * can reach argv. Reuses the validators from devnet.ts.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { isValidChainId, isValidL1Name, isValidToken } from "./devnet.js";

const KEY_DIR = path.join(homedir(), ".avalanche-cli", "key");
const SUBNETS_DIR = path.join(homedir(), ".avalanche-cli", "subnets");
const FUJI_C_RPC = "https://api.avax-test.network/ext/bc/C/rpc";
const FUJI = "Fuji";

export interface FujiParams {
  name: string;
  chainId: string;
  token: string;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI
const ANSI = /\x1b\[[0-9;]*[a-zA-Z]/g;

/** The key's C-Chain (0x) address, derived from avalanche-cli's stored key. */
function keyAddress(name: string): `0x${string}` | null {
  // Never let a request-derived name reach a filesystem path unvalidated
  // (defence-in-depth: /api/fuji/balance passes `name` straight here).
  if (!isValidL1Name(name)) return null;
  const file = path.join(KEY_DIR, `${name}.pk`);
  if (!existsSync(file)) return null;
  try {
    const hex = readFileSync(file, "utf8").trim().replace(/^0x/, "");
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
    return privateKeyToAccount(`0x${hex}`).address;
  } catch {
    return null;
  }
}

/** Create the CLI key if it doesn't exist yet, and return its C-Chain address. */
export async function ensureFujiKey(name: string): Promise<{ address: string | null }> {
  if (!isValidL1Name(name)) throw new Error("invalid L1 name");
  if (!existsSync(path.join(KEY_DIR, `${name}.pk`))) {
    await new Promise<void>((resolve) => {
      const child = spawn("avalanche", ["key", "create", name], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });
  }
  return { address: keyAddress(name) };
}

/** C-Chain AVAX balance of the key's address on Fuji (the faucet target). */
export async function getFujiKeyBalance(
  name: string,
): Promise<{ address: string | null; cBalance: string }> {
  const address = keyAddress(name);
  if (!address) return { address: null, cBalance: "0" };
  try {
    const res = await fetch(FUJI_C_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [address, "latest"],
      }),
    });
    const wei = BigInt(((await res.json()) as { result?: string }).result ?? "0x0");
    // AVAX with a few decimals, no bignum dep.
    const avax = Number(wei / 1_000_000_000_000n) / 1_000_000;
    return { address, cBalance: avax.toFixed(4) };
  } catch {
    return { address, cBalance: "0" };
  }
}

export interface FujiL1Status {
  deployed: boolean;
  rpcUrl: string | null;
  blockchainId: string | null;
  evmChainId: number | null;
  running: boolean;
}

/** Read a deployed Fuji L1's RPC from the sidecar and probe it live. */
export async function getFujiL1(name: string): Promise<FujiL1Status> {
  const empty: FujiL1Status = {
    deployed: false,
    rpcUrl: null,
    blockchainId: null,
    evmChainId: null,
    running: false,
  };
  if (!isValidL1Name(name)) return empty;
  const dir = path.join(SUBNETS_DIR, name);
  let sidecar: Record<string, unknown> = {};
  let genesis: Record<string, unknown> = {};
  try {
    sidecar = JSON.parse(readFileSync(path.join(dir, "sidecar.json"), "utf8"));
  } catch {
    return empty;
  }
  try {
    genesis = JSON.parse(readFileSync(path.join(dir, "genesis.json"), "utf8"));
  } catch {
    /* ignore */
  }
  const networks = (sidecar.Networks as Record<string, Record<string, unknown>> | undefined) ?? {};
  const fuji = networks[FUJI];
  const rpcEndpoints = (fuji?.RPCEndpoints as string[] | undefined) ?? [];
  const rpcUrl = rpcEndpoints[0] ?? null;
  const blockchainId = (fuji?.BlockchainID as string | undefined) ?? null;
  const evmChainId = (genesis.config as { chainId?: number } | undefined)?.chainId ?? null;
  if (!rpcUrl) return empty;

  let running = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    running = res.ok;
  } catch {
    running = false;
  }
  return { deployed: true, rpcUrl, blockchainId, evmChainId, running };
}

// --- Streamed actions: transfer (C->P) and deploy (create + deploy --fuji) ----

export type FujiAction = "transfer" | "deploy";

export function isFujiAction(v: string): v is FujiAction {
  return v === "transfer" || v === "deploy";
}

/** A positive decimal amount string, e.g. "0.3". */
export function isValidAmount(v: string): boolean {
  return /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,9})?$/.test(v) && Number(v) > 0 && Number(v) <= 1000;
}

function transferSteps(name: string, amount: string): [string, string[]][] {
  return [
    [
      "avalanche",
      [
        "key",
        "transfer",
        "--key",
        name,
        "--fuji",
        "--c-chain-sender",
        "--p-chain-receiver",
        "--amount",
        amount,
      ],
    ],
  ];
}

function deploySteps(params: FujiParams, ownerAddr: string): [string, string[]][] {
  const steps: [string, string[]][] = [];
  if (!existsSync(path.join(SUBNETS_DIR, params.name))) {
    steps.push([
      "avalanche",
      [
        "blockchain",
        "create",
        params.name,
        "--evm",
        "--latest",
        "--evm-chain-id",
        params.chainId,
        "--evm-token",
        params.token,
        "--proof-of-authority",
        "--validator-manager-owner",
        ownerAddr,
        "--proxy-contract-owner",
        ownerAddr,
        "--production-defaults",
        "--force",
      ],
    ]);
  }
  steps.push([
    "avalanche",
    [
      "blockchain",
      "deploy",
      params.name,
      "--fuji",
      "--key",
      params.name,
      "--use-local-machine",
      "--num-bootstrap-validators",
      "1",
      "--balance",
      "0.1",
      // Pre-answers the "deploy Validator Manager into an external blockchain?" prompt.
      // The final "fund relayer?" prompt is optional — with stdin closed it skips and the
      // L1 still deploys (the relayer only affects Interchain Messaging).
      "--vmc-L1",
    ],
  ]);
  return steps;
}

export interface RunHandle {
  cancel: () => void;
}

/** Run a Fuji action's fixed command sequence, streaming each line. */
export function runFujiAction(
  action: FujiAction,
  params: { name: string; chainId?: string; token?: string; amount?: string },
  onLine: (line: string) => void,
  onDone: (exitCode: number) => void,
): RunHandle {
  let steps: [string, string[]][];
  if (action === "transfer") {
    if (!isValidL1Name(params.name) || !params.amount || !isValidAmount(params.amount)) {
      onLine("✖ invalid transfer parameters");
      onDone(1);
      return { cancel: () => {} };
    }
    steps = transferSteps(params.name, params.amount);
  } else {
    if (
      !isValidL1Name(params.name) ||
      !params.chainId ||
      !isValidChainId(params.chainId) ||
      !params.token ||
      !isValidToken(params.token)
    ) {
      onLine("✖ invalid deploy parameters");
      onDone(1);
      return { cancel: () => {} };
    }
    const owner = keyAddress(params.name);
    if (!owner) {
      onLine("✖ key not found — create/fund it first");
      onDone(1);
      return { cancel: () => {} };
    }
    steps = deploySteps({ name: params.name, chainId: params.chainId, token: params.token }, owner);
  }

  let current: ChildProcess | null = null;
  let cancelled = false;
  const emit = (chunk: Buffer) => {
    const text = chunk.toString("utf8").replace(ANSI, "").replace(/\r/g, "\n");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t) onLine(t);
    }
  };
  const runStep = (i: number): void => {
    if (cancelled) return;
    const step = steps[i];
    if (!step) {
      onDone(0);
      return;
    }
    const [cmd, args] = step;
    onLine(`$ ${cmd} ${args.join(" ")}`);
    // `detached` so a Fuji validator node the CLI boots survives Studio restarts.
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
    current = child;
    child.stdout?.on("data", emit);
    child.stderr?.on("data", emit);
    child.on("error", (e) => {
      onLine(`error: ${e.message}`);
      onDone(1);
    });
    child.on("close", (code) => {
      if (cancelled) return;
      if (code && code !== 0) {
        onLine(`✖ exited with code ${code}`);
        onDone(code);
        return;
      }
      runStep(i + 1);
    });
  };
  runStep(0);
  return {
    cancel: () => {
      cancelled = true;
      current?.kill();
    },
  };
}
