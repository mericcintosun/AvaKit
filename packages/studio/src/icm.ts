/**
 * Interchain Messaging, driven server-side. Studio deploys the AvaKitMessenger
 * on each local L1 and sends a cross-chain message, signed with the public
 * EWOQ devnet key that avalanche-cli funds on every local network, so you can
 * watch a message cross chains without a wallet.
 *
 * Studio talks to each L1's RPC itself, over JSON-RPC: no other program is run.
 * Transactions are signed in this process (devkey.ts), so the key is never on
 * a command line, and they are only ever signed for an RPC URL on this machine.
 *
 * The text of a message is ABI-encoded into calldata by Studio and decoded by
 * Studio when it is read back, so it arrives exactly as it was typed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type AbiParameter,
  concatHex,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  type Hex,
  parseAbi,
  toFunctionSelector,
} from "viem";
import { cb58ToHex } from "./cb58.js";
import { devnetKeyRefusal, rpcHost, sendWithDevnetKey } from "./devkey.js";
import { type DevnetStatus, getDevnetStatus, type L1Info } from "./devnet.js";
import { BusyError, InputError, STOPPING_MESSAGE } from "./errors.js";
import { acquireActionLock, busyMessage } from "./lock.js";
import {
  CONSTRUCTOR_SIG,
  LAST_MESSAGE_SIG,
  MAX_MESSAGE_LENGTH_SIG,
  MESSAGES_RECEIVED_SIG,
  MESSENGER_BYTECODE,
  SEND_MESSAGE_SIG,
  SET_TRUSTED_REMOTE_SIG,
  TELEPORTER_PREDEPLOY,
  TRUSTED_REMOTE_SIG,
} from "./messenger-artifact.js";
import { studioStateDir } from "./paths.js";
import { studioProcesses } from "./processes.js";

/**
 * The longest message the messenger accepts, in UTF-8 bytes. Mirrors
 * `MAX_MESSAGE_LENGTH` in AvaKitMessenger.sol: a longer one reverts on the
 * source chain, so it is refused here with a readable reason instead.
 */
export const MAX_MESSAGE_BYTES = 256;

/** A signature without its return types: "lastMessage()(string)" -> "lastMessage()". */
function withoutReturns(sig: string): string {
  return sig.replace(/\)\([^()]*\)$/, ")");
}

/** The calldata of a call to `sig` with `values` for its `inputs`. */
function callData(
  sig: string,
  inputs: readonly AbiParameter[] = [],
  values: readonly unknown[] = [],
): Hex {
  const selector = toFunctionSelector(withoutReturns(sig));
  return inputs.length === 0
    ? selector
    : concatHex([selector, encodeAbiParameters(inputs, values)]);
}

const MAX_MESSAGE_LENGTH_CALL = callData(MAX_MESSAGE_LENGTH_SIG);
const LAST_MESSAGE_CALL = callData(LAST_MESSAGE_SIG);
const MESSAGES_RECEIVED_CALL = callData(MESSAGES_RECEIVED_SIG);
const SEND_MESSAGE_ABI = parseAbi([`function ${SEND_MESSAGE_SIG}`]);
const SET_TRUSTED_REMOTE_ABI = parseAbi([`function ${SET_TRUSTED_REMOTE_SIG}`]);
const CONSTRUCTOR_ABI = parseAbi([CONSTRUCTOR_SIG]);

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
      // The file is hand-editable, and its values become a contract address.
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
  /**
   * At least two L1s can exchange a message right now: two of the listed
   * chains each have a usable messenger, and each of those messengers accepts
   * the other's messages (they are linked). False until the messengers are
   * deployed — two running L1s alone are `hasPeers`, not `ready`.
   */
  ready: boolean;
  /**
   * At least two running, ICM-ready L1s are listed: enough to deploy and link
   * messengers (`deployMessengers`), after which `ready` holds.
   */
  hasPeers: boolean;
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
  blockchainIdHex: Hex;
}

/** A peer together with the usable messenger deployed on it. */
interface Endpoint extends Peer {
  messenger: string;
}

/** Why an L1 can't take part in Interchain Messaging right now, or null if it can. */
function blocker(l1: L1Info): string | null {
  if (!l1.deployed || !l1.rpcUrl) return "is not deployed on the local network";
  // Its "local" RPC is somewhere else (a hand-edited config): never signed
  // for, and not asked anything either.
  if (devnetKeyRefusal(l1.name, l1.rpcUrl)) return "has an RPC URL that is not on this machine";
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

/** What a local L1's RPC answered to one request. */
type RpcReply =
  | { result: string }
  /** The node's error; `reverted` when it says the contract reverted. */
  | { error: string; reverted: boolean }
  /** Nothing usable: unreachable, too slow, or not a JSON-RPC answer. */
  | null;

async function rpc(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<RpcReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
      // A local L1 answers itself; a redirect would lead off this machine.
      redirect: "error",
    });
    const json = (await res.json()) as { result?: unknown; error?: { message?: unknown } };
    if (res.ok && typeof json.result === "string") return { result: json.result };
    const message = json.error?.message;
    if (typeof message !== "string") return null;
    // EVM nodes word a revert "execution reverted" (under more than one error
    // code); every other error says nothing about the contract.
    return { error: message.slice(0, 600), reverted: /\brevert/i.test(message) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A quick look: what the RPC answered, `reverted`, or null for no usable answer. */
type RpcAnswer = { result: string } | { reverted: true } | null;

async function rpcRead(rpcUrl: string, method: string, params: unknown[]): Promise<RpcAnswer> {
  const reply = await rpc(rpcUrl, method, params, 3000);
  if (!reply) return null;
  if ("result" in reply) return reply;
  return reply.reverted ? { reverted: true } : null;
}

/**
 * Call a view function of the contract at `address` and return what it
 * returned, ABI-encoded. A failure carries the node's own words.
 */
async function readContract(rpcUrl: string, address: string, data: Hex): Promise<Hex> {
  const reply = await rpc(rpcUrl, "eth_call", [{ to: address, data }, "latest"], 10_000);
  if (!reply) throw new Error(`the L1's RPC (${rpcHost(rpcUrl)}) did not answer`);
  if ("error" in reply) throw new Error(reply.error);
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(reply.result)) throw new Error("the RPC answered no data");
  return reply.result as Hex;
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

/** The last message a messenger received, exactly as it was sent. */
async function readLastMessage(rpcUrl: string, messenger: string): Promise<string> {
  const raw = await readContract(rpcUrl, messenger, LAST_MESSAGE_CALL);
  const [text] = decodeAbiParameters([{ type: "string" }], raw);
  return text;
}

async function readReceived(rpcUrl: string, messenger: string): Promise<number | null> {
  try {
    const raw = await readContract(rpcUrl, messenger, MESSAGES_RECEIVED_CALL);
    const [count] = decodeAbiParameters([{ type: "uint256" }], raw);
    return count <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(count) : null;
  } catch {
    return null;
  }
}

/** The messenger `self`'s messenger accepts messages from, for `other`'s chain. */
async function readTrustedRemote(self: Endpoint, other: Peer): Promise<string> {
  const raw = await readContract(
    self.rpcUrl,
    self.messenger,
    callData(TRUSTED_REMOTE_SIG, [{ type: "bytes32" }], [other.blockchainIdHex]),
  );
  const [remote] = decodeAbiParameters([{ type: "address" }], raw);
  return remote;
}

export async function getIcmState(): Promise<IcmState> {
  const status = await getDevnetStatus();
  const state = readState();

  // The chains with a usable messenger: the ones a message can travel between.
  const endpoints: Endpoint[] = [];
  const chains = await Promise.all(
    listPeers(status).map(async (peer): Promise<IcmChain> => {
      const messenger = await usableMessenger(peer, state);
      let lastMessage: string | null = null;
      let messagesReceived: number | null = null;
      if (messenger) {
        endpoints.push({ ...peer, messenger });
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

  return {
    ready: await anyLinkedPair(endpoints),
    hasPeers: chains.length >= 2,
    chains,
    maxMessageBytes: MAX_MESSAGE_BYTES,
  };
}

/**
 * Whether `self`'s messenger accepts messages from `other`'s (read-only). A
 * link that cannot be read counts as missing: "ready" is only ever said of
 * what was seen.
 */
async function trusts(self: Endpoint, other: Endpoint): Promise<boolean> {
  try {
    return (await readTrustedRemote(self, other)).toLowerCase() === other.messenger.toLowerCase();
  } catch {
    return false;
  }
}

/** Whether any two of the chains have messengers that accept each other's messages. */
async function anyLinkedPair(endpoints: Endpoint[]): Promise<boolean> {
  for (const [i, a] of endpoints.entries()) {
    for (const b of endpoints.slice(i + 1)) {
      if ((await trusts(a, b)) && (await trusts(b, a))) return true;
    }
  }
  return false;
}

// Every transaction below is signed by the same dev key, so two at once would
// race on its nonce. Deploys and sends therefore run strictly one after
// another: within this process they queue, and each one takes Studio's action
// lock (lock.ts) while it runs. The lock is what keeps another Studio process
// (the MCP face, a second dashboard) from sending at the same time, and what
// keeps a deploy or send from running while an avalanche-cli action changes
// the network under it, and the other way round. While another action holds
// it, the deploy or send is refused (BusyError) instead of waiting.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(action: "icm deploy" | "icm send", task: () => Promise<T>): Promise<T> {
  const locked = async (): Promise<T> => {
    // Studio is stopping (shutdown.ts): nothing new starts.
    if (studioProcesses.isStopping()) throw new BusyError(STOPPING_MESSAGE, null);
    const lock = acquireActionLock(action);
    if (!lock.acquired) throw new BusyError(busyMessage(lock.holder), lock.holder);
    try {
      return await task();
    } finally {
      lock.release();
    }
  };
  const run = queue.then(locked, locked);
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
  const current = await readTrustedRemote(self, other);
  if (current.toLowerCase() === other.messenger.toLowerCase()) return;
  await sendWithDevnetKey(self, {
    to: self.messenger as Hex,
    data: encodeFunctionData({
      abi: SET_TRUSTED_REMOTE_ABI,
      functionName: "setTrustedRemote",
      args: [other.blockchainIdHex, other.messenger as Hex],
    }),
  });
}

/**
 * Deploy the messenger on every peer that doesn't have a usable one, then link
 * them all: each messenger only accepts messages from its registered trusted
 * remote, so without the link the relayer's delivery reverts.
 */
export function deployMessengers(): Promise<IcmState> {
  return exclusive("icm deploy", async () => {
    const peers = listPeers(await getDevnetStatus());
    const state = readState();
    const endpoints: Endpoint[] = [];
    for (const peer of peers) {
      let messenger = await usableMessenger(peer, state);
      if (!messenger) {
        // The messenger's constructor takes the chain's Teleporter: on
        // avalanche-cli local devnets that is always the canonical predeploy.
        const receipt = await sendWithDevnetKey(peer, {
          data: encodeDeployData({
            abi: CONSTRUCTOR_ABI,
            bytecode: MESSENGER_BYTECODE as Hex,
            args: [TELEPORTER_PREDEPLOY],
          }),
        });
        if (!receipt.contractAddress || !ADDRESS.test(receipt.contractAddress)) {
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
  // The text only ever leaves Studio inside ABI-encoded calldata, so nothing
  // could read it as an option. A leading dash is refused all the same, as
  // the dashboard always did: no rule rests on a single safeguard.
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

  return exclusive("icm send", async () => {
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

    const receipt = await sendWithDevnetKey(src, {
      to: fromMessenger as Hex,
      data: encodeFunctionData({
        abi: SEND_MESSAGE_ABI,
        functionName: "sendMessage",
        args: [dst.blockchainIdHex, toMessenger as Hex, message],
      }),
    });
    return { txHash: receipt.transactionHash, receivedBefore };
  });
}
