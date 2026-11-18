/**
 * Local devnet control, Avalanche-specific. Reads avalanche-cli's own metadata
 * (sidecar.json / genesis.json) for status — no fragile CLI-output parsing — and
 * drives create/deploy/start/stop by spawning avalanche-cli with argument
 * ARRAYS (never a shell string). The only request-derived values that reach an
 * argument are a custom L1's name, chain id and token symbol, each strictly
 * whitelist-validated first.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { subnetsDir } from "./paths.js";
import { type RunHandle, runSteps, type Step } from "./steps.js";
import { isValidChainId, isValidL1Name, isValidToken } from "./validators.js";

const LOCAL = "Local Network";

export interface L1Info {
  name: string;
  evmChainId: number | null;
  token: string | null;
  teleporterReady: boolean;
  teleporterMessenger: string | null;
  /** CB58 blockchain ID (Teleporter's hex form is resolved when sending). */
  blockchainId: string | null;
  rpcUrl: string | null;
  deployed: boolean;
  running: boolean;
}

export interface DevnetStatus {
  running: boolean;
  l1s: L1Info[];
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function probeRpc(rpcUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function readL1(name: string): L1Info {
  const dir = path.join(subnetsDir(), name);
  const sidecar = readJson(path.join(dir, "sidecar.json")) ?? {};
  const genesis = readJson(path.join(dir, "genesis.json")) ?? {};

  const networks = (sidecar.Networks as Record<string, Record<string, unknown>> | undefined) ?? {};
  const local = networks[LOCAL];
  const rpcEndpoints = (local?.RPCEndpoints as string[] | undefined) ?? [];
  const chainId = (genesis.config as { chainId?: number } | undefined)?.chainId ?? null;

  return {
    name,
    evmChainId: typeof chainId === "number" ? chainId : null,
    token: (sidecar.TokenSymbol as string | undefined) ?? null,
    teleporterReady: Boolean(sidecar.TeleporterReady),
    teleporterMessenger: (local?.TeleporterMessengerAddress as string | undefined) ?? null,
    blockchainId: (local?.BlockchainID as string | undefined) ?? null,
    rpcUrl: rpcEndpoints[0] ?? null,
    deployed: rpcEndpoints.length > 0,
    running: false,
  };
}

function listL1Names(): string[] {
  const dir = subnetsDir();
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export async function getDevnetStatus(): Promise<DevnetStatus> {
  const l1s = listL1Names().map(readL1);
  // "Running" = a deployed L1's RPC actually answers.
  await Promise.all(
    l1s.map(async (l1) => {
      if (l1.deployed && l1.rpcUrl) l1.running = await probeRpc(l1.rpcUrl);
    }),
  );
  return { running: l1s.some((l1) => l1.running), l1s };
}

// --- Actions: command sequences built from whitelisted values only ------------

export type DevnetAction = "start" | "stop" | "create-icm" | "create-l1";

/** Parameters for launching a single custom L1 (create-l1). */
export interface L1Params {
  name: string;
  chainId: string;
  token: string;
}

// Strict, whitelist-only validators (validators.ts, shared with the dashboard).
// They are the ONLY request-derived values that reach an avalanche-cli
// argument; callers (server/MCP) reject anything that fails them.
export { isValidChainId, isValidL1Name, isValidToken };
export function isValidL1Params(p: Partial<L1Params>): p is L1Params {
  return (
    typeof p.name === "string" &&
    isValidL1Name(p.name) &&
    typeof p.chainId === "string" &&
    isValidChainId(p.chainId) &&
    typeof p.token === "string" &&
    isValidToken(p.token)
  );
}

// No `--force`: overwriting an existing chain's config wipes its deployment
// metadata (sidecar Networks), so we only create chains that don't exist yet.
const CREATE = (name: string, id: string, token: string): Step => ({
  cmd: "avalanche",
  args: [
    "blockchain",
    "create",
    name,
    "--evm",
    "--latest",
    "--evm-chain-id",
    id,
    "--evm-token",
    token,
    "--test-defaults",
    "--sovereign=false",
    "--icm",
  ],
});

/**
 * Deploy a blockchain to the local network. avalanche-cli refuses when it is
 * already deployed there ("Error: blockchain chain1 has already been
 * deployed"); for an idempotent spin-up that is the state we want, not a
 * failure. The pattern is that exact report about THIS chain, so neither an
 * informational "ICM Messenger has already been deployed to …" line nor an
 * unrelated "… is already in use" error can pass for it.
 */
const DEPLOY_LOCAL = (name: string): Step => ({
  cmd: "avalanche",
  args: ["blockchain", "deploy", name, "--local"],
  alreadyDone: new RegExp(
    `\\b(?:blockchain|subnet|chain|l1) "?${name.replace(/[^a-z0-9]/gi, "\\$&")}"? has already been deployed\\b`,
    "i",
  ),
});

/** "The network is already running" is the state `network start` was asked for. */
const NETWORK_ALREADY_UP =
  /\bnetwork (?:is|has) already (?:been )?(?:running|booted|bootstrapped|started)\b/i;

/** The chain ID and token symbol avalanche-cli has on file for an L1 config. */
export interface ExistingL1Config {
  /** Null when the config's genesis has no readable EVM chain ID. */
  evmChainId: number | null;
  /** Null when the config's sidecar has no readable token symbol. */
  token: string | null;
}

/**
 * The avalanche-cli config named `name`, or null when there is none. A config
 * is never overwritten by Studio (see CREATE), so one that exists is what a
 * deploy under that name will use — whatever chain ID or token was asked for.
 */
export function existingL1Config(name: string): ExistingL1Config | null {
  if (!isValidL1Name(name) || !existsSync(path.join(subnetsDir(), name))) return null;
  const { evmChainId, token } = readL1(name);
  return { evmChainId, token: typeof token === "string" ? token : null };
}

function describeConfig(config: ExistingL1Config): string {
  const chain =
    config.evmChainId !== null ? `chain ID ${config.evmChainId}` : "an unreadable chain ID";
  // The symbol comes from a file on disk: quote no more of it than a symbol can be.
  const token =
    config.token !== null ? `token ${config.token.slice(0, 16)}` : "an unreadable token";
  return `${chain} and ${token}`;
}

/**
 * Why an L1 can't be created or deployed under `params.name` as requested, or
 * null when it can. A config with that name and ANOTHER chain ID or token is
 * the reason: Studio would skip the create, deploy the existing chain, and
 * report the requested values as done — for a chain that has neither.
 */
export function l1ConfigConflict(params: L1Params): string | null {
  const existing = existingL1Config(params.name);
  if (!existing) return null;
  if (existing.evmChainId === Number(params.chainId) && existing.token === params.token) {
    return null;
  }
  return (
    `An L1 config named "${params.name}" already exists with ${describeConfig(existing)} — ` +
    `not the requested chain ID ${params.chainId} and token ${params.token}. ` +
    "Choose another name, ask for the existing values to reuse that config, or delete it " +
    `yourself (avalanche blockchain delete ${params.name}) and try again.`
  );
}

/** The log line that says an existing config is used as it is, not created again. */
export function reuseNote(name: string): string | undefined {
  const existing = existingL1Config(name);
  return existing
    ? `↳ using the existing config for ${name} (${describeConfig(existing)}) — not creating it again`
    : undefined;
}

/** Idempotent "spin up": create only the missing L1s, then (re)deploy both. */
function createIcmSteps(): Step[] {
  const existing = new Set(listL1Names());
  return [
    ...(existing.has("chain1") ? [] : [CREATE("chain1", "1001", "TOK1")]),
    ...(existing.has("chain2") ? [] : [CREATE("chain2", "1002", "TOK2")]),
    { ...DEPLOY_LOCAL("chain1"), note: reuseNote("chain1") },
    { ...DEPLOY_LOCAL("chain2"), note: reuseNote("chain2") },
  ];
}

// A single custom L1 — the "launch your own L1" flow. Non-sovereign for a
// zero-prompt local deploy (same rationale as the ICM chains). Create only if it
// doesn't exist yet, then deploy locally. An existing config is reused only
// when it IS the chain that was asked for; callers check that first
// (l1ConfigConflict) and refuse the request, so the throw here is a backstop.
function createL1Steps(params: L1Params): Step[] {
  const conflict = l1ConfigConflict(params);
  if (conflict) throw new Error(conflict);
  const note = reuseNote(params.name);
  const create: Step = {
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
      "--test-defaults",
      "--sovereign=false",
    ],
  };
  return note ? [{ ...DEPLOY_LOCAL(params.name), note }] : [create, DEPLOY_LOCAL(params.name)];
}

function stepsFor(action: DevnetAction, params?: L1Params): Step[] {
  if (action === "start") {
    return [{ cmd: "avalanche", args: ["network", "start"], alreadyDone: NETWORK_ALREADY_UP }];
  }
  if (action === "stop") return [{ cmd: "avalanche", args: ["network", "stop"] }];
  if (action === "create-l1") {
    if (!params || !isValidL1Params(params)) {
      throw new Error("create-l1 requires validated params");
    }
    return createL1Steps(params);
  }
  return createIcmSteps();
}

export function isDevnetAction(v: string): v is DevnetAction {
  return v === "start" || v === "stop" || v === "create-icm" || v === "create-l1";
}

/** Run an action's command sequence, streaming each line. Returns a cancel handle. */
export function runDevnetAction(
  action: DevnetAction,
  onLine: (line: string) => void,
  onDone: (exitCode: number) => void,
  params?: L1Params,
): RunHandle {
  return runSteps(stepsFor(action, params), onLine, onDone);
}

/** Promise variant: run an action to completion, collecting the log (for MCP). */
export function runDevnetActionAsync(
  action: DevnetAction,
  params?: L1Params,
): Promise<{ exitCode: number; log: string[] }> {
  return new Promise((resolve) => {
    const log: string[] = [];
    runDevnetAction(
      action,
      (line) => log.push(line),
      (exitCode) => resolve({ exitCode, log }),
      params,
    );
  });
}
