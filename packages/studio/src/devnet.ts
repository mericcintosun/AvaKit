/**
 * Local devnet control, Avalanche-specific. Reads avalanche-cli's own metadata
 * (sidecar.json / genesis.json) for status — no fragile CLI-output parsing — and
 * drives create/deploy/start/stop through spawn with FIXED argument arrays
 * (never a shell string, never request-derived args).
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const SUBNETS_DIR = path.join(homedir(), ".avalanche-cli", "subnets");
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
  const dir = path.join(SUBNETS_DIR, name);
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
  if (!existsSync(SUBNETS_DIR)) return [];
  try {
    return readdirSync(SUBNETS_DIR, { withFileTypes: true })
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

// --- Actions: fixed command sequences, no user input reaches argv ------------

export type DevnetAction = "start" | "stop" | "create-icm" | "create-l1";

/** Parameters for launching a single custom L1 (create-l1). */
export interface L1Params {
  name: string;
  chainId: string;
  token: string;
}

// Strict, whitelist-only validators. Even though we spawn with an argument
// ARRAY (never a shell), we still constrain these so a value can never be read
// as a flag or path — the same "no arbitrary user input reaches argv" posture as
// the fixed ICM action. Callers (server/MCP) reject anything that fails these.
export function isValidL1Name(v: string): boolean {
  return /^[a-z][a-z0-9]{1,31}$/.test(v);
}
export function isValidToken(v: string): boolean {
  return /^[A-Z][A-Z0-9]{0,7}$/.test(v);
}
export function isValidChainId(v: string): boolean {
  if (!/^[1-9][0-9]{0,9}$/.test(v)) return false;
  const n = Number(v);
  return n >= 1 && n <= 4294967295;
}
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
const CREATE = (name: string, id: string, token: string): [string, string[]] => [
  "avalanche",
  [
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
];

/** Idempotent "spin up": create only the missing L1s, then (re)deploy both. */
function createIcmSteps(): [string, string[]][] {
  const existing = new Set(listL1Names());
  return [
    ...(existing.has("chain1") ? [] : [CREATE("chain1", "1001", "TOK1")]),
    ...(existing.has("chain2") ? [] : [CREATE("chain2", "1002", "TOK2")]),
    ["avalanche", ["blockchain", "deploy", "chain1", "--local"]],
    ["avalanche", ["blockchain", "deploy", "chain2", "--local"]],
  ];
}

// A single custom L1 — the "launch your own L1" flow. Non-sovereign for a
// zero-prompt local deploy (same rationale as the ICM chains). Create only if it
// doesn't exist yet, then deploy locally.
function createL1Steps(params: L1Params): [string, string[]][] {
  const existing = new Set(listL1Names());
  return [
    ...(existing.has(params.name)
      ? []
      : [
          [
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
              "--test-defaults",
              "--sovereign=false",
            ],
          ] as [string, string[]],
        ]),
    ["avalanche", ["blockchain", "deploy", params.name, "--local"]],
  ];
}

function stepsFor(action: DevnetAction, params?: L1Params): [string, string[]][] {
  if (action === "start") return [["avalanche", ["network", "start"]]];
  if (action === "stop") return [["avalanche", ["network", "stop"]]];
  if (action === "create-l1") {
    if (!params) throw new Error("create-l1 requires validated params");
    return createL1Steps(params);
  }
  return createIcmSteps();
}

export function isDevnetAction(v: string): v is DevnetAction {
  return v === "start" || v === "stop" || v === "create-icm" || v === "create-l1";
}

// A non-zero exit is benign when avalanche-cli is only telling us the target is
// already in the desired state (already deployed / network already running).
const BENIGN = /already (been )?(deployed|running|bootstrapped)|is already/i;

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strips ANSI escape sequences
const ANSI = /\x1b\[[0-9;]*[a-zA-Z]/g;

function emitLines(chunk: Buffer, onLine: (line: string) => void): void {
  const text = chunk.toString("utf8").replace(ANSI, "").replace(/\r/g, "\n");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) onLine(trimmed);
  }
}

export interface RunHandle {
  cancel: () => void;
}

/** Run an action's fixed command sequence, streaming each line. Returns a cancel handle. */
export function runDevnetAction(
  action: DevnetAction,
  onLine: (line: string) => void,
  onDone: (exitCode: number) => void,
  params?: L1Params,
): RunHandle {
  const steps = stepsFor(action, params);
  let current: ChildProcess | null = null;
  let cancelled = false;

  const runStep = (i: number): void => {
    if (cancelled) return;
    const step = steps[i];
    if (!step) {
      onDone(0);
      return;
    }
    const [cmd, args] = step;
    onLine(`$ ${cmd} ${args.join(" ")}`);
    let benign = false;
    // `detached` puts avalanche-cli in its own process group so the local
    // network it boots survives even if Studio is stopped or restarted.
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
    current = child;
    const scan = (c: Buffer) => {
      if (BENIGN.test(c.toString())) benign = true;
      emitLines(c, onLine);
    };
    child.stdout?.on("data", scan);
    child.stderr?.on("data", scan);
    child.on("error", (e) => {
      onLine(`error: ${e.message}`);
      onDone(1);
    });
    child.on("close", (code) => {
      if (cancelled) return;
      if (code && code !== 0 && !benign) {
        onLine(`✖ exited with code ${code}`);
        onDone(code);
        return;
      }
      if (code && code !== 0) onLine("↳ already in place — continuing");
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
