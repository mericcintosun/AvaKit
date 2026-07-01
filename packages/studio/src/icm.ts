/**
 * Interchain Messaging, driven server-side with `cast`. Studio deploys the
 * AvaKitMessenger on each local L1 and sends a cross-chain message using the
 * pre-funded local dev key — so you can watch a message cross chains without a
 * wallet. Every call is execFile("cast", [...]) with array args (no shell).
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { cb58ToHex } from "./cb58.js";
import { getDevnetStatus } from "./devnet.js";
import {
  LAST_MESSAGE_SIG,
  MESSAGES_RECEIVED_SIG,
  MESSENGER_BYTECODE,
  SEND_MESSAGE_SIG,
} from "./messenger-artifact.js";

const exec = promisify(execFile);

// Pre-funded local dev key (EWOQ). Public and for LOCAL devnets only.
const DEV_KEY = "0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027";

const STATE_DIR = path.join(homedir(), ".avakit-studio");
const STATE_FILE = path.join(STATE_DIR, "icm-state.json");

type State = Record<string, string>; // chainName -> messenger address

function readState(): State {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return {};
  }
}

function writeState(state: State): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export interface IcmChain {
  name: string;
  evmChainId: number | null;
  rpcUrl: string | null;
  blockchainIdHex: string | null;
  running: boolean;
  messenger: string | null;
  lastMessage: string | null;
  messagesReceived: number | null;
}

export interface IcmState {
  ready: boolean;
  chains: IcmChain[];
}

async function castCall(rpcUrl: string, address: string, sig: string): Promise<string> {
  const { stdout } = await exec("cast", ["call", address, sig, "--rpc-url", rpcUrl], {
    timeout: 15000,
  });
  return stdout.trim().replace(/^"|"$/g, "");
}

export async function getIcmState(): Promise<IcmState> {
  const status = await getDevnetStatus();
  const state = readState();

  const chains = await Promise.all(
    status.l1s.map(async (l1): Promise<IcmChain> => {
      const messenger = state[l1.name] ?? null;
      let lastMessage: string | null = null;
      let messagesReceived: number | null = null;
      if (l1.running && l1.rpcUrl && messenger) {
        try {
          lastMessage = await castCall(l1.rpcUrl, messenger, LAST_MESSAGE_SIG);
          const count = await castCall(l1.rpcUrl, messenger, MESSAGES_RECEIVED_SIG);
          messagesReceived = Number.parseInt(count.split(" ")[0] ?? "0", 10);
        } catch {
          // messenger not reachable yet
        }
      }
      return {
        name: l1.name,
        evmChainId: l1.evmChainId,
        rpcUrl: l1.rpcUrl,
        blockchainIdHex: l1.blockchainId ? cb58ToHex(l1.blockchainId) : null,
        running: l1.running,
        messenger,
        lastMessage,
        messagesReceived,
      };
    }),
  );

  return { ready: status.running && chains.length >= 2, chains };
}

/** Deploy the messenger on every running L1 that doesn't have one yet. */
export async function deployMessengers(): Promise<IcmState> {
  const status = await getDevnetStatus();
  const state = readState();
  for (const l1 of status.l1s) {
    if (!l1.running || !l1.rpcUrl || state[l1.name]) continue;
    // Flags before positionals: cast treats anything after `--create <code>` as
    // the constructor SIG/ARGS, so the RPC flags must come first.
    const { stdout } = await exec(
      "cast",
      [
        "send",
        "--rpc-url",
        l1.rpcUrl,
        "--private-key",
        DEV_KEY,
        "--json",
        "--create",
        MESSENGER_BYTECODE,
      ],
      { timeout: 90000, maxBuffer: 8 * 1024 * 1024 },
    );
    const receipt = JSON.parse(stdout) as { contractAddress?: string };
    if (receipt.contractAddress) state[l1.name] = receipt.contractAddress;
  }
  writeState(state);
  return getIcmState();
}

/** Send a cross-chain message from one L1's messenger to the other's. */
export async function sendIcmMessage(
  from: string,
  to: string,
  message: string,
): Promise<{ txHash: string }> {
  const status = await getDevnetStatus();
  const state = readState();
  const src = status.l1s.find((l) => l.name === from);
  const dst = status.l1s.find((l) => l.name === to);
  if (!src || !dst) throw new Error("unknown chain");
  if (!src.running || !src.rpcUrl) throw new Error(`${from} is not running`);
  if (!dst.blockchainId) throw new Error(`${to} has no blockchain id`);
  const fromMessenger = state[from];
  const toMessenger = state[to];
  if (!fromMessenger || !toMessenger) throw new Error("deploy the messengers first");

  // Flags before positionals so the variadic constructor ARGS don't swallow them.
  const { stdout } = await exec(
    "cast",
    [
      "send",
      "--rpc-url",
      src.rpcUrl,
      "--private-key",
      DEV_KEY,
      "--json",
      fromMessenger,
      SEND_MESSAGE_SIG,
      cb58ToHex(dst.blockchainId),
      toMessenger,
      message,
    ],
    { timeout: 90000, maxBuffer: 8 * 1024 * 1024 },
  );
  const receipt = JSON.parse(stdout) as { transactionHash?: string };
  return { txHash: receipt.transactionHash ?? "" };
}
