/**
 * Interchain Messaging, driven server-side with `cast`. Studio deploys the
 * AvaKitMessenger on each local L1 and sends a cross-chain message using the
 * pre-funded local dev key — so you can watch a message cross chains without a
 * wallet. Every call is execFile("cast", [...]) with array args (no shell). An
 * L1's RPC URL is only ever the value of `--rpc-url`, and every other value
 * that comes from a request or a file sits after a `--`, so cast can never
 * read it as an option.
 *
 * The text of a message never reaches cast as text at all: it goes out inside
 * calldata that Studio ABI-encodes itself, and it is read back as raw bytes
 * that Studio decodes. cast would otherwise parse it (a leading quote starts a
 * string literal) and re-format it (quotes and backslashes come back escaped).
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { decodeAbiParameters, encodeFunctionData, parseAbi, toFunctionSelector } from "viem/utils";
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

/**
 * The getter of that cap, as a cast signature like the ones in
 * messenger-artifact.ts. Only a messenger that has the cap answers it, which is
 * how one deployed by an earlier Studio is told apart (see `capsMessageLength`).
 */
const MAX_MESSAGE_LENGTH_SIG = "MAX_MESSAGE_LENGTH()(uint256)";

/** A cast signature without its return types: "lastMessage()(string)" -> "lastMessage()". */
function withoutReturns(sig: string): string {
  return sig.replace(/\)\([^()]*\)$/, ")");
}

const MAX_MESSAGE_LENGTH_CALL = toFunctionSelector(withoutReturns(MAX_MESSAGE_LENGTH_SIG));
const SEND_MESSAGE_ABI = parseAbi([`function ${SEND_MESSAGE_SIG}`]);

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

/** A peer together with the usable messenger deployed on it. */
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

/** Run cast and return its stdout. Failures carry cast's own words, not the command line. */
async function cast(args: string[], timeout: number): Promise<string> {
  try {
    const { stdout } = await exec("cast", args, { timeout, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    if (err.code === "ENOENT") {
      throw new Error("Foundry's cast is not installed or not on your PATH");
    }
    if (err.killed) throw new Error("cast timed out");
    // execFile's own message repeats the whole command line (dev key included);
    // what cast printed is the part that explains the failure.
    const detail = (err.stderr ?? "").trim();
    throw new Error(detail ? detail.slice(0, 600) : "cast failed");
  }
}

/** Read from a contract. With return types in `sig` cast prints the decoded values. */
async function castCall(
  rpcUrl: string,
  address: string,
  sig: string,
  args: string[] = [],
): Promise<string> {
  const stdout = await cast(["call", "--rpc-url", rpcUrl, "--", address, sig, ...args], 15000);
  return stdout.trim();
}

interface Receipt {
  status?: unknown;
  transactionHash?: unknown;
  contractAddress?: unknown;
}

/**
 * Send a transaction signed by the dev key and return its receipt. `rest` is
 * what follows the common flags; whatever in it is not a flag of ours must come
 * after a `--`, so cast can never take it for an option.
 */
async function castSend(rpcUrl: string, rest: string[]): Promise<Receipt> {
  const stdout = await cast(
    ["send", "--rpc-url", rpcUrl, "--private-key", DEV_KEY, "--json", ...rest],
    90000,
  );
  let receipt: Receipt | null;
  try {
    receipt = JSON.parse(stdout) as Receipt | null;
  } catch {
    receipt = null;
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("cast send printed no receipt");
  }
  // cast exits 0 for a transaction that was mined and then reverted.
  if (receipt.status === "0x0") throw new Error("the transaction was mined but reverted");
  return receipt;
}

/** What a local L1's RPC answered to one read-only request. */
type RpcAnswer =
  | { result: string }
  /** The node ran the call and the contract reverted. */
  | { reverted: true }
  /** No usable answer: unreachable, too slow, or an error of the node's own. */
  | null;

async function rpcRead(rpcUrl: string, method: string, params: unknown[]): Promise<RpcAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    const json = (await res.json()) as { result?: unknown; error?: { message?: unknown } };
    if (res.ok && typeof json.result === "string") return { result: json.result };
    // EVM nodes word a revert "execution reverted" (under more than one error
    // code); every other error says nothing about the contract.
    const message = json.error?.message;
    return typeof message === "string" && /\brevert/i.test(message) ? { reverted: true } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether a contract lives at `address` on the chain behind `rpcUrl`. Null
 * means the RPC did not answer: unknown, which is never treated as "gone".
 */
async function hasCode(rpcUrl: string, address: string): Promise<boolean | null> {
  const answer = await rpcRead(rpcUrl, "eth_getCode", [address, "latest"]);
  return answer && "result" in answer ? !/^0x0*$/.test(answer.result) : null;
}

/**
 * Whether the contract at `address` is a messenger that caps the message
 * length. One deployed by an earlier Studio has no `MAX_MESSAGE_LENGTH`, so the
 * call reverts — and it also asks for too little delivery gas, which is why a
 * longer message sent through it never arrives. Null means the RPC gave no
 * usable answer: unknown.
 */
async function capsMessageLength(rpcUrl: string, address: string): Promise<boolean | null> {
  const answer = await rpcRead(rpcUrl, "eth_call", [
    { to: address, data: MAX_MESSAGE_LENGTH_CALL },
    "latest",
  ]);
  if (!answer) return null;
  // The getter returns exactly one 32-byte word.
  return "result" in answer && /^0x[0-9a-fA-F]{64}$/.test(answer.result);
}

/**
 * The messenger Studio recorded for this chain, if it is still the one to use.
 * A recorded address alone proves nothing:
 *  - a devnet that was wiped and re-deployed (`avalanche network clean`, which
 *    AvaKit's own template scripts run) keeps its chain names but none of its
 *    contracts, so the address may hold no code;
 *  - a devnet that outlived a Studio upgrade still has the messenger an earlier
 *    Studio deployed, without the message-length cap.
 * Either way the answer is null — "no messenger here" — and the next deploy
 * puts a current one in its place and relinks the chains. The messenger Studio
 * deploys (messenger-artifact.ts) must therefore have the cap itself.
 * When the RPC cannot say, the recorded address is kept: unknown is not gone.
 */
async function usableMessenger(peer: Peer, state: State): Promise<string | null> {
  const stored = state.get(peer.name);
  if (!stored) return null;
  const code = await hasCode(peer.rpcUrl, stored);
  if (code === null) return stored;
  if (!code) return null;
  return (await capsMessageLength(peer.rpcUrl, stored)) === false ? null : stored;
}

/**
 * The last message a messenger received, exactly as it was sent. It is read as
 * raw ABI bytes and decoded here: cast's own rendering of a string escapes
 * quotes, backslashes and control characters.
 */
async function readLastMessage(rpcUrl: string, messenger: string): Promise<string> {
  const raw = await castCall(rpcUrl, messenger, withoutReturns(LAST_MESSAGE_SIG));
  const [text] = decodeAbiParameters([{ type: "string" }], raw as `0x${string}`);
  return text;
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
      const messenger = await usableMessenger(peer, state);
      let lastMessage: string | null = null;
      let messagesReceived: number | null = null;
      if (messenger) {
        try {
          lastMessage = await readLastMessage(peer.rpcUrl, messenger);
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
 * A link that cannot be read is a failure, never "probably fine": a message
 * sent over a missing link is accepted on the source chain and then dropped.
 */
async function ensureTrusted(self: Endpoint, other: Endpoint): Promise<void> {
  const current = await castCall(self.rpcUrl, self.messenger, TRUSTED_REMOTE_SIG, [
    other.blockchainIdHex,
  ]);
  if (current.toLowerCase() === other.messenger.toLowerCase()) return;
  await castSend(self.rpcUrl, [
    "--",
    self.messenger,
    SET_TRUSTED_REMOTE_SIG,
    other.blockchainIdHex,
    other.messenger,
  ]);
}

/**
 * Deploy the messenger on every peer that doesn't have a usable one, then link
 * them all: each messenger only accepts messages from its registered trusted
 * remote, so without the link the relayer's delivery reverts.
 */
export function deployMessengers(): Promise<IcmState> {
  return exclusive(async () => {
    const peers = listPeers(await getDevnetStatus());
    const state = readState();
    const endpoints: Endpoint[] = [];
    for (const peer of peers) {
      let messenger = await usableMessenger(peer, state);
      if (!messenger) {
        // cast treats everything after `--create <code>` as the constructor
        // SIG/ARGS, so they come last. They pass the chain's Teleporter to the
        // messenger's constructor — on avalanche-cli local devnets that is
        // always the canonical predeploy.
        const receipt = await castSend(peer.rpcUrl, [
          "--create",
          MESSENGER_BYTECODE,
          CONSTRUCTOR_SIG,
          TELEPORTER_PREDEPLOY,
        ]);
        if (typeof receipt.contractAddress !== "string" || !ADDRESS.test(receipt.contractAddress)) {
          throw new Error(`deploying the messenger on ${peer.name} returned no contract address`);
        }
        // What was just deployed must be a messenger `usableMessenger` accepts.
        // If it is not, the bytecode this build ships and that check have
        // drifted apart: say so now, rather than record an address that the
        // very next look would call "no messenger here".
        if (
          (await hasCode(peer.rpcUrl, receipt.contractAddress)) &&
          (await capsMessageLength(peer.rpcUrl, receipt.contractAddress)) === false
        ) {
          throw new Error(
            `the messenger deployed on ${peer.name} has no message-length cap: this build of Studio ships outdated messenger bytecode`,
          );
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
  const bytes = Buffer.byteLength(message, "utf8");
  if (bytes > MAX_MESSAGE_BYTES) {
    return `message is ${bytes} bytes; the messenger accepts at most ${MAX_MESSAGE_BYTES} (UTF-8)`;
  }
  // The text only ever reaches cast inside hex calldata, after a `--`, so it
  // could not be read as an option anyway. A leading dash is refused all the
  // same, as the dashboard always did: that never rests on a single safeguard.
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
    const fromMessenger = await usableMessenger(src, state);
    const toMessenger = await usableMessenger(dst, state);
    if (!fromMessenger || !toMessenger) throw new InputError("deploy the messengers first");

    // The destination drops messages from anyone but its trusted remote, so a
    // missing link means "sent, never delivered". Check it on every send: the
    // read is cheap and it repairs messengers deployed without the link.
    await ensureTrusted({ ...dst, messenger: toMessenger }, { ...src, messenger: fromMessenger });
    const receivedBefore = await readReceived(dst.rpcUrl, toMessenger);

    // The whole call as calldata: cast carries the text as hex and never parses it.
    const calldata = encodeFunctionData({
      abi: SEND_MESSAGE_ABI,
      functionName: "sendMessage",
      args: [dst.blockchainIdHex, toMessenger as `0x${string}`, message],
    });
    const receipt = await castSend(src.rpcUrl, ["--", fromMessenger, calldata]);
    return {
      txHash: typeof receipt.transactionHash === "string" ? receipt.transactionHash : "",
      receivedBefore,
    };
  });
}
