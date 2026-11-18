/**
 * Fuji L1 launch — the "graduate your L1 to the public testnet" flow, driven
 * step by step from the Studio UI instead of avalanche-cli's interactive prompts.
 *
 * Same security posture as devnet.ts: spawn avalanche-cli with argument ARRAYS
 * (never a shell string); the only request-derived values are the L1
 * name / chain id / token / amount, each strictly whitelist-validated before it
 * can reach argv (validators.ts — the wizard in the dashboard applies the same
 * functions before it lets a step go ahead).
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { l1ConfigConflict, reuseNote } from "./devnet.js";
import { InputError } from "./errors.js";
import { keyDir, subnetsDir } from "./paths.js";
import type { Step } from "./steps.js";
import { isValidAmount, isValidChainId, isValidL1Name, isValidToken } from "./validators.js";

const FUJI_C_RPC = "https://api.avax-test.network/ext/bc/C/rpc";
const FUJI = "Fuji";

export interface FujiParams {
  name: string;
  chainId: string;
  token: string;
}

/** The key's C-Chain (0x) address, derived from avalanche-cli's stored key. */
function keyAddress(name: string): `0x${string}` | null {
  // Never let a request-derived name reach a filesystem path unvalidated
  // (defence-in-depth: /api/fuji/balance passes `name` straight here).
  if (!isValidL1Name(name)) return null;
  const file = path.join(keyDir(), `${name}.pk`);
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
  if (!isValidL1Name(name)) throw new InputError("invalid L1 name");
  if (!existsSync(path.join(keyDir(), `${name}.pk`))) {
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

export interface FujiBalance {
  address: string | null;
  /** AVAX on the C-Chain. "0" when unknown — check `error` before trusting it. */
  cBalance: string;
  /** Why the balance could not be read (the RPC failed), or null when it was. */
  error: string | null;
}

/** C-Chain AVAX balance of the key's address on Fuji (the faucet target). */
export async function getFujiKeyBalance(name: string): Promise<FujiBalance> {
  const address = keyAddress(name);
  if (!address) return { address: null, cBalance: "0", error: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
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
      signal: controller.signal,
    });
    const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (!res.ok || typeof json.result !== "string") {
      // An RPC error is NOT a zero balance — say so instead of showing "0".
      return {
        address,
        cBalance: "0",
        error: json.error?.message ?? `the Fuji RPC answered ${res.status}`,
      };
    }
    const wei = BigInt(json.result);
    // AVAX with a few decimals, no bignum dep.
    const avax = Number(wei / 1_000_000_000_000n) / 1_000_000;
    return { address, cBalance: avax.toFixed(4), error: null };
  } catch {
    return { address, cBalance: "0", error: "could not reach the Fuji RPC" };
  } finally {
    clearTimeout(timer);
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
  const dir = path.join(subnetsDir(), name);
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

export { isValidAmount };

function transferSteps(name: string, amount: string): Step[] {
  return [
    {
      cmd: "avalanche",
      args: [
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
    },
  ];
}

function deploySteps(params: FujiParams, ownerAddr: string): Step[] {
  const steps: Step[] = [];
  // An existing config is deployed as it is — only ever when it has the chain
  // ID and token that were asked for (prepareFujiAction refuses otherwise), and
  // the log says that it is being reused.
  const reused = reuseNote(params.name);
  if (!reused) {
    steps.push({
      cmd: "avalanche",
      args: [
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
    });
  }
  steps.push({
    cmd: "avalanche",
    ...(reused ? { note: reused } : {}),
    args: [
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
  });
  return steps;
}

export interface FujiRequest {
  name: string;
  chainId?: string;
  token?: string;
  amount?: string;
}

export type PreparedFujiAction =
  | {
      steps: Step[];
      /** The request values that passed validation — safe to store and show. */
      params: Record<string, string>;
    }
  | { error: string };

/**
 * Validate a Fuji action's parameters and build its command sequence (run it
 * with `runSteps`). Nothing is spawned here; an `error` means the request must
 * be refused.
 */
export function prepareFujiAction(action: FujiAction, request: FujiRequest): PreparedFujiAction {
  const nameOk = isValidL1Name(request.name);
  const chainId = request.chainId && isValidChainId(request.chainId) ? request.chainId : null;
  const token = request.token && isValidToken(request.token) ? request.token : null;
  const amount = request.amount && isValidAmount(request.amount) ? request.amount : null;
  // Only validated values are ever echoed back.
  const params: Record<string, string> = {
    ...(nameOk ? { name: request.name } : {}),
    ...(chainId ? { chainId } : {}),
    ...(token ? { symbol: token } : {}),
    ...(amount ? { amount } : {}),
  };

  if (action === "transfer") {
    if (!nameOk || !amount) return { error: "invalid transfer parameters" };
    return { steps: transferSteps(request.name, amount), params };
  }
  if (!nameOk || !chainId || !token) return { error: "invalid deploy parameters" };
  const owner = keyAddress(request.name);
  if (!owner) return { error: "key not found — create/fund it first" };
  // A config with this name and another chain ID or token would be deployed as
  // it is and reported as the L1 that was asked for: refuse before anything runs.
  const conflict = l1ConfigConflict({ name: request.name, chainId, token });
  if (conflict) return { error: conflict };
  return { steps: deploySteps({ name: request.name, chainId, token }, owner), params };
}
