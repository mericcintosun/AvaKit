/**
 * Interchain Messaging, driven server-side with `cast`. Studio deploys the
 * AvaKitMessenger on each local L1 and sends a cross-chain message using the
 * pre-funded local dev key — so you can watch a message cross chains without a
 * wallet. Every call is execFile("cast", [...]) with array args (no shell), and
 * every value that comes from a request or a file sits after a `--`, so cast
 * can never read it as an option.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { cb58ToHex } from "./cb58.js";
import { type DevnetStatus, getDevnetStatus, type L1Info } from "./devnet.js";
import { InputError } from "./errors.js";
import {
  CONSTRUCTOR_SIG,
  LAST_MESSAGE_SIG,
  MESSAGES_RECEIVED_SIG,
  MESSENGER_BYTECODE,
  SEND_MESSAGE_SIG,
  SET_TRUSTED_REMOTE_SIG,
  TELEPORTER_PREDEPLOY,
  TRUSTED_REMOTE_SIG,
} from "./messenger-artifact.js";
import { studioStateDir } from "./paths.js";

const exec = promisify(execFile);

// Pre-funded local dev key (EWOQ). Public and for LOCAL devnets only.
const DEV_KEY = "0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027";

/**
 * The longest message the messenger accepts, in UTF-8 bytes. Mirrors
 * `MAX_MESSAGE_LENGTH` in AvaKitMessenger.sol: a longer one reverts on the
 * source chain, so it is refused here with a readable reason instead.
 */
export const MAX_MESSAGE_BYTES = 256;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** chain name -> the messenger Studio deployed there */
type State = Map<string, string>;

function stateFile(): string {
  return path.join(studioStateDir(), "icm-state.json");
}

function readState(): State {
  const state: State = new Map();
  try {
    const raw = JSON.parse(readFileSync(stateFile(), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return state;
    for (const [name, address] of Object.entries(raw)) {
      // The file is hand-editable and its values end up in a cast argument.
      if (typeof address === "string" && ADDRESS.test(address)) state.set(name, address);
    }
  } catch {
    // no state yet
  }
  return state;
}

function writeState(state: State): void {
  const dir = studioStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(stateFile(), JSON.stringify(Object.fromEntries(state), null, 2));
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
  /** At least two L1s can exchange a message right now. */
  ready: boolean;
  /** Only the running, Teleporter-ready L1s of the local network. */
  chains: IcmChain[];
  /** The longest message `sendIcmMessage` accepts, in UTF-8 bytes. */
  maxMessageBytes: number;
}

/** A local L1 that can take part in Interchain Messaging right now. */
interface Peer {
  name: string;
  evmChainId: number | null;
  rpcUrl: string;
  blockchainIdHex: `0x${string}`;
}

/** A peer together with the live messenger deployed on it. */
interface Endpoint extends Peer {
  messenger: string;
}

/** Why an L1 can't take part in Interchain Messaging right now, or null if it can. */
function blocker(l1: L1Info): string | null {
  if (!l1.deployed || !l1.rpcUrl) return "is not deployed on the local network";
  if (!l1.running) return "is not running";
  if (!l1.teleporterReady) return "was created without Interchain Messaging";
  if (!l1.blockchainId) return "has no blockchain ID";
  return null;
}

function toPeer(l1: L1Info): Peer | null {
  if (blocker(l1) !== null) return null;
  try {
    return {
      name: l1.name,
      evmChainId: l1.evmChainId,
      rpcUrl: l1.rpcUrl as string,
      blockchainIdHex: cb58ToHex(l1.blockchainId as string),
    };
  } catch {
    // A blockchain ID that does not decode can't be routed to — not a peer.
    return null;
  }
}

/**
 * The L1s that belong in the Interchain state. avalanche-cli keeps a directory
 * for every L1 ever configured — stopped ones, Fuji-only ones, ones without
 * Teleporter — and none of those can send or receive a local message, so
 * listing them would only block the ones that can.
 */
function listPeers(status: DevnetStatus): Peer[] {
  return status.l1s.map(toPeer).filter((peer): peer is Peer => peer !== null);
}

class ToolMissingError extends Error {}

/** Run cast and return its stdout. Failures carry cast's own words, not the command line. */
async function cast(args: string[], timeout: number): Promise<string> {
  try {
    const { stdout } = await exec("cast", args, { timeout, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    if (err.code === "ENOENT") {
      throw new ToolMissingError("Foundry's cast is not installed or not on your PATH");
    }
    if (err.killed) throw new Error("cast timed out");
    // execFile's own message repeats the whole command line (dev key included);
    // what cast printed is the part that explains the failure.
    const detail = (err.stderr ?? "").trim();
    throw new Error(detail ? detail.slice(0, 600) : "cast failed");
  }
}

async function castCall(
  rpcUrl: string,
  address: string,
  sig: string,
  args: string[] = [],
): Promise<string> {
  const stdout = await cast(["call", "--rpc-url", rpcUrl, "--", address, sig, ...args], 15000);
  return stdout.trim().replace(/^"|"$/g, "");
}

async function castSend(rpcUrl: string, positionals: string[]): Promise<string> {
  // Flags first, then `--`: nothing after it can be taken for an option.
  return cast(
    ["send", "--rpc-url", rpcUrl, "--private-key", DEV_KEY, "--json", "--", ...positionals],
    90000,
  );
}

/**
 * Whether a contract lives at `address` on the chain behind `rpcUrl`. Null
 * means the RPC did not answer: unknown, which is never treated as "gone".
 */
async function hasCode(rpcUrl: string, address: string): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getCode",
        params: [address, "latest"],
      }),
      signal: controller.signal,
    });
    const json = (await res.json()) as { result?: unknown };
    if (!res.ok || typeof json.result !== "string") return null;
    return !/^0x0*$/.test(json.result);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The messenger Studio recorded for this chain, if a contract still lives
 * there. A devnet that was wiped and re-deployed (`avalanche network clean`,
 * which AvaKit's own template scripts run) keeps its chain names but none of
 * its contracts, so a recorded address alone proves nothing.
 */
async function liveMessenger(peer: Peer, state: State): Promise<string | null> {
  const stored = state.get(peer.name);
  if (!stored) return null;
  return (await hasCode(peer.rpcUrl, stored)) === false ? null : stored;
}

async function readReceived(rpcUrl: string, messenger: string): Promise<number | null> {
  try {
    const count = await castCall(rpcUrl, messenger, MESSAGES_RECEIVED_SIG);
    const n = Number.parseInt(count.split(" ")[0] ?? "", 10);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

export async function getIcmState(): Promise<IcmState> {
  const status = await getDevnetStatus();
  const state = readState();

  const chains = await Promise.all(
    listPeers(status).map(async (peer): Promise<IcmChain> => {
      const messenger = await liveMessenger(peer, state);
      let lastMessage: string | null = null;
      let messagesReceived: number | null = null;
      if (messenger) {
        try {
          lastMessage = await castCall(peer.rpcUrl, messenger, LAST_MESSAGE_SIG);
          messagesReceived = await readReceived(peer.rpcUrl, messenger);
        } catch {
          // messenger not reachable yet
        }
      }
      return {
        name: peer.name,
        evmChainId: peer.evmChainId,
        rpcUrl: peer.rpcUrl,
        blockchainIdHex: peer.blockchainIdHex,
        running: true,
        messenger,
        lastMessage,
        messagesReceived,
      };
    }),
  );

  return { ready: chains.length >= 2, chains, maxMessageBytes: MAX_MESSAGE_BYTES };
}

// Every transaction below is signed by the same dev key, so two at once would
// race on its nonce. Deploys and sends therefore run strictly one after another.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

/**
 * Make `self`'s messenger accept messages from `other`'s: register it as the
 * trusted remote for `other`'s chain. Idempotent — reads `trustedRemote` first
 * and only sends the transaction when the link is missing or points elsewhere.
 * Pre-allowlist messengers (from an old icm-state.json) don't have
 * `trustedRemote`: the read reverts and the pair is left alone, since those
 * old contracts accept every source anyway.
 */
async function ensureTrusted(self: Endpoint, other: Endpoint): Promise<void> {
  let current: string;
  try {
    current = await castCall(self.rpcUrl, self.messenger, TRUSTED_REMOTE_SIG, [
      other.blockchainIdHex,
    ]);
  } catch (e) {
    if (e instanceof ToolMissingError) throw e;
    return;
  }
  if (current.toLowerCase() === other.messenger.toLowerCase()) return;
  await castSend(self.rpcUrl, [
    self.messenger,
    SET_TRUSTED_REMOTE_SIG,
    other.blockchainIdHex,
    other.messenger,
  ]);
}

/**
 * Deploy the messenger on every peer that doesn't have a live one, then link
 * them all: each messenger only accepts messages from its registered trusted
 * remote, so without the link the relayer's delivery reverts.
 */
export function deployMessengers(): Promise<IcmState> {
  return exclusive(async () => {
    const peers = listPeers(await getDevnetStatus());
    const state = readState();
    const endpoints: Endpoint[] = [];
    for (const peer of peers) {
      let messenger = await liveMessenger(peer, state);
      if (!messenger) {
        // Flags before positionals: cast treats anything after `--create <code>`
        // as the constructor SIG/ARGS, so the RPC flags must come first. The
        // trailing SIG/ARGS pass the chain's Teleporter to the messenger's
        // constructor — on avalanche-cli local devnets that is always the
        // canonical predeploy.
        const stdout = await cast(
          [
            "send",
            "--rpc-url",
            peer.rpcUrl,
            "--private-key",
            DEV_KEY,
            "--json",
            "--create",
            MESSENGER_BYTECODE,
            CONSTRUCTOR_SIG,
            TELEPORTER_PREDEPLOY,
          ],
          90000,
        );
        const receipt = JSON.parse(stdout) as { contractAddress?: unknown };
        if (typeof receipt.contractAddress !== "string" || !ADDRESS.test(receipt.contractAddress)) {
          throw new Error(`deploying the messenger on ${peer.name} returned no contract address`);
        }
        messenger = receipt.contractAddress;
        state.set(peer.name, messenger);
        // Persist at once: a failure further down must not lose this address.
        writeState(state);
      }
      endpoints.push({ ...peer, messenger });
    }

    // Link every ordered pair of CHAINS. Compare by chain, never by messenger
    // address: the same key at the same nonce deploys to the same address on
    // every fresh L1, so two different chains routinely share one.
    for (const self of endpoints) {
      for (const other of endpoints) {
        if (other.name === self.name) continue;
        await ensureTrusted(self, other);
      }
    }
    return getIcmState();
  });
}

/** Why `message` can't be sent, or null when it can. */
export function messageProblem(message: string): string | null {
  if (message.length === 0) return "message is empty";
  if (message.includes("\0")) return "message cannot contain a NUL character";
  const bytes = Buffer.byteLength(message, "utf8");
  if (bytes > MAX_MESSAGE_BYTES) {
    return `message is ${bytes} bytes; the messenger accepts at most ${MAX_MESSAGE_BYTES} (UTF-8)`;
  }
  // `--` already keeps cast from reading it as an option; refusing a leading
  // dash as well means that never rests on a single safeguard.
  if (message.startsWith("-")) return "message cannot start with '-'";
  return null;
}

function requirePeer(status: DevnetStatus, name: string): Peer {
  const l1 = status.l1s.find((l) => l.name === name);
  if (!l1) throw new InputError(`unknown chain: ${name}`);
  const reason = blocker(l1);
  if (reason) throw new InputError(`${name} ${reason}`);
  const peer = toPeer(l1);
  if (!peer) throw new InputError(`${name} has an invalid blockchain ID`);
  return peer;
}

/**
 * Send a cross-chain message from one L1's messenger to another's. All the
 * checks live here, so every caller (the HTTP route and the MCP tool) gets the
 * same ones. `receivedBefore` is the destination's delivery count just before
 * the send — a higher count afterwards means THIS message arrived.
 */
export async function sendIcmMessage(
  from: string,
  to: string,
  message: string,
): Promise<{ txHash: string; receivedBefore: number | null }> {
  if (!from || !to || from === to) throw new InputError("pick two different chains");
  const problem = messageProblem(message);
  if (problem) throw new InputError(problem);

  return exclusive(async () => {
    const status = await getDevnetStatus();
    const state = readState();
    const src = requirePeer(status, from);
    const dst = requirePeer(status, to);
    const fromMessenger = await liveMessenger(src, state);
    const toMessenger = await liveMessenger(dst, state);
    if (!fromMessenger || !toMessenger) throw new InputError("deploy the messengers first");

    // The destination drops messages from anyone but its trusted remote, so a
    // missing link means "sent, never delivered". Check it on every send: the
    // read is cheap and it repairs messengers deployed without the link.
    await ensureTrusted({ ...dst, messenger: toMessenger }, { ...src, messenger: fromMessenger });
    const receivedBefore = await readReceived(dst.rpcUrl, toMessenger);

    const stdout = await castSend(src.rpcUrl, [
      fromMessenger,
      SEND_MESSAGE_SIG,
      dst.blockchainIdHex,
      toMessenger,
      message,
    ]);
    const receipt = JSON.parse(stdout) as { transactionHash?: string };
    return { txHash: receipt.transactionHash ?? "", receivedBefore };
  });
}
