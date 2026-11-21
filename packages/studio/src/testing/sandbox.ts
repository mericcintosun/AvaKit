/**
 * Test-only helpers (never imported by the shipped code).
 *
 * A sandbox gives a test its own HOME, so avalanche-cli's and Studio's files are
 * fake, and its own PATH holding nothing but stub executables. The real
 * `avalanche` (or any other tool) can therefore never be reached from a test,
 * and neither can the developer's real ~/.avalanche-cli or ~/.avakit-studio.
 *
 * The local L1s are a fake JSON-RPC endpoint on 127.0.0.1 (startFakeRpc): it
 * answers the reads Studio makes and takes the raw signed transactions Studio
 * sends, recovering who signed each one.
 */

import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  decodeAbiParameters,
  encodeAbiParameters,
  type Hex,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type TransactionSerialized,
  toFunctionSelector,
} from "viem";

export interface L1Fixture {
  /** Present when the L1 is deployed on the local network. */
  local?: { rpcUrl: string; blockchainId: string };
  /** Present when the L1 is deployed on Fuji. */
  fuji?: { rpcUrl: string; blockchainId: string };
  teleporterReady?: boolean;
  evmChainId?: number;
  token?: string;
}

export interface Sandbox {
  /** The fake home directory. */
  home: string;
  /**
   * Install a stub executable on the sandbox PATH. `handler` is the JavaScript
   * source of a function `(args: string[]) => { out?, err?, code? }` (it may be
   * async) that decides what one invocation prints and how it exits.
   */
  stub: (name: string, handler: string) => void;
  /** The argv of every invocation of a stub so far, oldest first. */
  calls: (name: string) => string[][];
  /** Write an avalanche-cli L1 config (sidecar.json + genesis.json). */
  addL1: (name: string, fixture?: L1Fixture) => void;
  /** Write a private key file where avalanche-cli keeps its keys. */
  addKey: (name: string, privateKeyHex: string) => void;
  writeIcmState: (state: Record<string, unknown>) => void;
  readIcmState: () => Record<string, unknown>;
  /** Restore the environment and delete the sandbox. */
  dispose: () => void;
}

export function createSandbox(): Sandbox {
  const root = mkdtempSync(path.join(tmpdir(), "avakit-studio-test-"));
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });

  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    PATH: process.env.PATH,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  // ONLY the stub directory: a missing stub must fail with ENOENT, never fall
  // through to a real avalanche-cli (or anything else) on the developer's machine.
  process.env.PATH = bin;
  if (homedir() !== home) {
    throw new Error("sandbox: os.homedir() does not follow HOME on this platform");
  }

  const subnets = path.join(home, ".avalanche-cli", "subnets");
  const icmState = path.join(home, ".avakit-studio", "icm-state.json");
  const logOf = (name: string) => path.join(bin, `${name}.calls.jsonl`);

  return {
    home,

    stub(name, handler) {
      const script = path.join(bin, `${name}.stub.mjs`);
      writeFileSync(
        script,
        [
          'import { appendFileSync } from "node:fs";',
          "const args = process.argv.slice(2);",
          `appendFileSync(${JSON.stringify(logOf(name))}, JSON.stringify(args) + "\\n");`,
          `const handler = (${handler});`,
          "const result = (await handler(args)) ?? {};",
          "if (result.out) process.stdout.write(result.out);",
          "if (result.err) process.stderr.write(result.err);",
          "process.exitCode = result.code ?? 0;",
          "",
        ].join("\n"),
      );
      const launcher = path.join(bin, name);
      // Absolute paths throughout: the sandbox PATH has no `node` on it.
      writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
      chmodSync(launcher, 0o755);
    },

    calls(name) {
      if (!existsSync(logOf(name))) return [];
      return readFileSync(logOf(name), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
    },

    addL1(name, fixture = {}) {
      const dir = path.join(subnets, name);
      mkdirSync(dir, { recursive: true });
      const network = (n: { rpcUrl: string; blockchainId: string }) => ({
        BlockchainID: n.blockchainId,
        TeleporterMessengerAddress: "0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf",
        RPCEndpoints: [n.rpcUrl],
      });
      writeFileSync(
        path.join(dir, "sidecar.json"),
        JSON.stringify({
          Name: name,
          TokenSymbol: fixture.token ?? "TOK",
          TeleporterReady: fixture.teleporterReady ?? true,
          Networks: {
            ...(fixture.local ? { "Local Network": network(fixture.local) } : {}),
            ...(fixture.fuji ? { Fuji: network(fixture.fuji) } : {}),
          },
        }),
      );
      writeFileSync(
        path.join(dir, "genesis.json"),
        JSON.stringify({ config: { chainId: fixture.evmChainId ?? DEFAULT_CHAIN_ID } }),
      );
    },

    addKey(name, privateKeyHex) {
      const dir = path.join(home, ".avalanche-cli", "key");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${name}.pk`), privateKeyHex);
    },

    writeIcmState(state) {
      mkdirSync(path.dirname(icmState), { recursive: true });
      writeFileSync(icmState, JSON.stringify(state));
    },

    readIcmState() {
      return existsSync(icmState)
        ? (JSON.parse(readFileSync(icmState, "utf8")) as Record<string, unknown>)
        : {};
    },

    dispose() {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** The EVM chain ID `addL1` writes into genesis.json, and the fake RPC answers, by default. */
export const DEFAULT_CHAIN_ID = 1001;

/** `sendMessage(bytes32,address,string)`: how the fake chain recognises a message being sent. */
export const SEND_MESSAGE_SELECTOR = toFunctionSelector("sendMessage(bytes32,address,string)");
/** `setTrustedRemote(bytes32,address)`: how the fake chain recognises a link. */
export const SET_TRUSTED_REMOTE_SELECTOR = toFunctionSelector("setTrustedRemote(bytes32,address)");

/** The messenger's getters the fake chain answers, by selector. */
const GETTERS: Record<string, string> = {
  [toFunctionSelector("MAX_MESSAGE_LENGTH()")]: "MAX_MESSAGE_LENGTH",
  [toFunctionSelector("trustedRemote(bytes32)")]: "trustedRemote",
  [toFunctionSelector("lastMessage()")]: "lastMessage",
  [toFunctionSelector("messagesReceived()")]: "messagesReceived",
};

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * A well-formed blockchain ID in both of its spellings. The CB58 encoder here
 * is written independently of the decoder under test (big-integer arithmetic).
 */
export function blockchainId(seed: number): { cb58: string; hex: `0x${string}` } {
  const payload = createHash("sha256").update(`avakit-studio-test-chain-${seed}`).digest();
  const full = Buffer.concat([payload, createHash("sha256").update(payload).digest().subarray(-4)]);
  let n = BigInt(`0x${full.toString("hex")}`);
  let cb58 = "";
  while (n > 0n) {
    cb58 = ALPHABET[Number(n % 58n)] + cb58;
    n /= 58n;
  }
  for (const byte of full) {
    if (byte !== 0) break;
    cb58 = `1${cb58}`;
  }
  return { cb58, hex: `0x${payload.toString("hex")}` };
}

/** How the fake chains answer transactions and the messenger's getters. */
export interface FakeChainOptions {
  /** The address a deployment lands at, per chain. A chain left out gets a receipt without one. */
  deploy?: Record<string, string>;
  /** Make every deployment fail: the node refuses it with this message. */
  deployError?: string;
  /** Make reading `trustedRemote` fail: the node answers with this error. */
  trustedRemoteError?: string;
  /** How long a `sendMessage` transaction takes to be accepted (to observe overlap). */
  sendDelayMs?: number;
  /** How long a deployment takes to be accepted (to observe overlap). */
  deployDelayMs?: number;
  /** The text every messenger's `lastMessage()` holds (default "hello"). */
  lastMessage?: string;
  /** The `status` of every receipt: "0x0" is a transaction that was mined but reverted. */
  receiptStatus?: "0x1" | "0x0";
}

/** A transaction a fake chain received, decoded. */
export interface FakeTransaction {
  chain: string;
  /** Who signed it: recovered from the signature, not taken on trust. */
  from: string;
  /** Null for a deployment. */
  to: string | null;
  data: Hex;
  /** The chain ID it was signed for. */
  chainId: number | undefined;
  /** The raw signed transaction, exactly as it arrived. */
  raw: Hex;
}

export interface FakeRpc {
  /** An RPC endpoint for a chain; every `chain` path is served by this one server. */
  url: (chain: string) => string;
  /**
   * Put a contract at `address` on `chain`: `eth_getCode` reports it, and it
   * answers the messenger's getters like a current AvaKitMessenger.
   */
  setCode: (chain: string, address: string, code?: string) => void;
  /**
   * Put a messenger from before the message-length cap at `address`: it has
   * code, but calling `MAX_MESSAGE_LENGTH()` reverts. `error` is how the node
   * words that revert (default: the way geth-family nodes do).
   */
  setOutdated: (chain: string, address: string, error?: { code: number; message: string }) => void;
  /** Make `eth_getCode` fail on `chain` (the RPC answers, but with an error). */
  breakCode: (chain: string) => void;
  /** Make `eth_call` fail on `chain` with an error that is not a revert. */
  breakCall: (chain: string) => void;
  /** Answer `eth_chainId` on `chain` with `id` (default DEFAULT_CHAIN_ID). */
  setChainId: (chain: string, id: number) => void;
  /** How the chains answer from now on (replaces what was configured before). */
  configure: (options?: FakeChainOptions) => void;
  /** What the chains did, in order: "create <chain>", "link <chain>", "send begin|end <chain>". */
  journal: () => string[];
  /** Every transaction received so far, oldest first. */
  transactions: () => FakeTransaction[];
  /** Every getter called so far, as "chain:getter" ("chain1:lastMessage"). */
  reads: () => string[];
  /** Every JSON-RPC method received so far, as "chain:method". */
  seen: string[];
  close: () => Promise<void>;
}

type Answer = { result: unknown } | { error: { code: number; message: string } };

const word = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A local JSON-RPC endpoint that answers like a running L1 (loopback only). */
export async function startFakeRpc(): Promise<FakeRpc> {
  const code = new Map<string, string>();
  const outdated = new Map<string, { code: number; message: string }>();
  const brokenCode = new Set<string>();
  const brokenCall = new Set<string>();
  const chainIds = new Map<string, number>();
  const nonces = new Map<string, number>();
  const receipts = new Map<string, Record<string, unknown>>();
  /** "chain|messenger|remote chain" -> the remote messenger it trusts */
  const trusted = new Map<string, string>();
  const journal: string[] = [];
  const transactions: FakeTransaction[] = [];
  const reads: string[] = [];
  const seen: string[] = [];
  let options: FakeChainOptions = {};

  const busy = { error: { code: -32000, message: "busy" } };

  const read = (chain: string, call: { to?: string; data?: string }): Answer => {
    if (brokenCall.has(chain)) return busy;
    const to = String(call.to).toLowerCase();
    const at = `${chain}:${to}`;
    const data = call.data ?? "0x";
    const getter = GETTERS[data.slice(0, 10)] ?? data.slice(0, 10);
    reads.push(`${chain}:${getter}`);
    // No contract there: the call returns nothing.
    if (!code.has(at)) return { result: "0x" };
    if (getter === "MAX_MESSAGE_LENGTH") {
      const revert = outdated.get(at);
      return revert ? { error: revert } : { result: word(256) };
    }
    if (getter === "trustedRemote") {
      if (options.trustedRemoteError) {
        return { error: { code: -32000, message: options.trustedRemoteError } };
      }
      const remote = trusted.get(`${chain}|${to}|0x${data.slice(10, 74)}`) ?? ZERO_ADDRESS;
      return { result: encodeAbiParameters([{ type: "address" }], [remote as Hex]) };
    }
    if (getter === "lastMessage") {
      return {
        result: encodeAbiParameters([{ type: "string" }], [options.lastMessage ?? "hello"]),
      };
    }
    if (getter === "messagesReceived") return { result: word(3) };
    return { result: "0x" };
  };

  const send = async (chain: string, raw: Hex): Promise<Answer> => {
    const tx = parseTransaction(raw as TransactionSerialized);
    const from = await recoverTransactionAddress({
      serializedTransaction: raw as TransactionSerialized,
    });
    const data = (tx.data ?? "0x") as Hex;
    const to = tx.to ?? null;
    transactions.push({ chain, from, to, data, chainId: tx.chainId, raw });

    let contractAddress: string | null = null;
    if (to === null) {
      if (options.deployError) return { error: { code: -32000, message: options.deployError } };
      if (options.deployDelayMs) await sleep(options.deployDelayMs);
      journal.push(`create ${chain}`);
      contractAddress = options.deploy?.[chain] ?? null;
    } else if (data.startsWith(SET_TRUSTED_REMOTE_SELECTOR)) {
      const [remoteChain, remote] = decodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }],
        `0x${data.slice(10)}`,
      );
      trusted.set(`${chain}|${to.toLowerCase()}|${remoteChain}`, remote);
      journal.push(`link ${chain}`);
    } else if (data.startsWith(SEND_MESSAGE_SELECTOR)) {
      journal.push(`send begin ${chain}`);
      if (options.sendDelayMs) await sleep(options.sendDelayMs);
      journal.push(`send end ${chain}`);
    }

    const sender = `${chain}:${from.toLowerCase()}`;
    nonces.set(sender, (nonces.get(sender) ?? 0) + 1);
    const hash = keccak256(raw);
    receipts.set(hash, {
      transactionHash: hash,
      transactionIndex: "0x0",
      blockHash: keccak256(hash),
      blockNumber: "0x2",
      from,
      to,
      contractAddress,
      cumulativeGasUsed: "0x5208",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x5d21dba00",
      logs: [],
      logsBloom: `0x${"00".repeat(256)}`,
      status: options.receiptStatus ?? "0x1",
      type: "0x2",
    });
    return { result: hash };
  };

  /** What the chain answers: a result, or a JSON-RPC error. */
  const answer = async (chain: string, method: string, params: unknown[]): Promise<Answer> => {
    switch (method) {
      case "eth_chainId":
        return { result: `0x${(chainIds.get(chain) ?? DEFAULT_CHAIN_ID).toString(16)}` };
      case "eth_blockNumber":
        return { result: "0x2" };
      case "eth_getBlockByNumber":
        return {
          result: {
            number: "0x2",
            hash: `0x${"ab".repeat(32)}`,
            parentHash: `0x${"cd".repeat(32)}`,
            timestamp: "0x6553f100",
            gasLimit: "0xe4e1c0",
            gasUsed: "0x0",
            baseFeePerGas: "0x5d21dba00",
            transactions: [],
          },
        };
      case "eth_maxPriorityFeePerGas":
        return { result: "0x0" };
      case "eth_gasPrice":
        return { result: "0x5d21dba00" };
      case "eth_estimateGas":
        return { result: "0x200000" };
      case "eth_getTransactionCount": {
        const sender = `${chain}:${String(params[0]).toLowerCase()}`;
        return { result: `0x${(nonces.get(sender) ?? 0).toString(16)}` };
      }
      case "eth_sendRawTransaction":
        return send(chain, params[0] as Hex);
      case "eth_getTransactionReceipt":
        return { result: receipts.get(String(params[0])) ?? null };
      case "eth_getCode":
        if (brokenCode.has(chain)) return busy;
        return { result: code.get(`${chain}:${String(params[0]).toLowerCase()}`) ?? "0x" };
      case "eth_call":
        return read(chain, params[0] as { to?: string; data?: string });
      default:
        return { error: { code: -32601, message: `the method ${method} does not exist` } };
    }
  };

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString();
    });
    req.on("end", () => {
      const chain = (req.url ?? "/").split("/").filter(Boolean)[0] ?? "";
      const { id, method, params } = JSON.parse(body) as {
        id: number;
        method: string;
        params: unknown[];
      };
      seen.push(`${chain}:${method}`);
      void answer(chain, method, params ?? []).then((reply) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id, ...reply }));
      });
    });
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
  return {
    url: (chain) => `http://127.0.0.1:${port}/${chain}/rpc`,
    setCode: (chain, address, bytecode = "0x6080") => {
      code.set(`${chain}:${address.toLowerCase()}`, bytecode);
      outdated.delete(`${chain}:${address.toLowerCase()}`);
    },
    setOutdated: (chain, address, error = { code: -32000, message: "execution reverted" }) => {
      code.set(`${chain}:${address.toLowerCase()}`, "0x6080");
      outdated.set(`${chain}:${address.toLowerCase()}`, error);
    },
    breakCode: (chain) => {
      brokenCode.add(chain);
    },
    breakCall: (chain) => {
      brokenCall.add(chain);
    },
    setChainId: (chain, id) => {
      chainIds.set(chain, id);
    },
    configure: (next = {}) => {
      options = next;
    },
    journal: () => [...journal],
    transactions: () => [...transactions],
    reads: () => [...reads],
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
