/**
 * Test-only helpers (never imported by the shipped code).
 *
 * A sandbox gives a test its own HOME, so avalanche-cli's and Studio's files are
 * fake, and its own PATH holding nothing but stub executables. The real
 * `avalanche` and `cast` can therefore never be reached from a test, and neither
 * can the developer's real ~/.avalanche-cli or ~/.avakit-studio.
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
import { encodeAbiParameters, toFunctionSelector } from "viem/utils";

export interface L1Fixture {
  /** Present when the L1 is deployed on the local network. */
  local?: { rpcUrl: string; blockchainId: string };
  /** Present when the L1 is deployed on Fuji. */
  fuji?: { rpcUrl: string; blockchainId: string };
  teleporterReady?: boolean;
  evmChainId?: number;
  token?: string;
}

export interface FakeCastOptions {
  /** The address `cast send --create` "deploys" to, per chain. */
  deploy?: Record<string, string>;
  /** Make `--create` fail with this on stderr. */
  deployError?: string;
  /** Make reading `trustedRemote` fail with this on stderr. */
  trustedRemoteError?: string;
  /** How long a `sendMessage` transaction takes (to observe overlap). */
  sendDelayMs?: number;
  /** How long a `--create` (a messenger deployment) takes (to observe overlap). */
  deployDelayMs?: number;
  /** The text every messenger's `lastMessage()` holds (default "hello"). */
  lastMessage?: string;
  /** The `status` of every receipt: "0x0" is a transaction that was mined but reverted. */
  receiptStatus?: "0x1" | "0x0";
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
  /**
   * Install a `cast` stub that behaves like Foundry's against the fake RPC: it
   * "deploys" messengers, remembers every `setTrustedRemote`, and answers the
   * reads Studio makes. It refuses positionals that do not follow a `--`, and
   * it only knows `sendMessage` as raw calldata and `lastMessage` as raw bytes —
   * the two places where a message's text must not pass through cast as text.
   */
  fakeCast: (options?: FakeCastOptions) => void;
  /** What the fake cast did, in order: "create <chain>", "link <chain>", "send begin|end <chain>". */
  castJournal: () => string[];
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
  // through to a real avalanche-cli or cast on the developer's machine.
  process.env.PATH = bin;
  if (homedir() !== home) {
    throw new Error("sandbox: os.homedir() does not follow HOME on this platform");
  }

  const subnets = path.join(home, ".avalanche-cli", "subnets");
  const icmState = path.join(home, ".avakit-studio", "icm-state.json");
  const castState = path.join(root, "fake-cast-state.json");
  const logOf = (name: string) => path.join(bin, `${name}.calls.jsonl`);

  const stub = (name: string, handler: string): void => {
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
  };

  return {
    home,
    stub,

    fakeCast(options = {}) {
      stub("cast", fakeCastSource(castState, options));
    },

    castJournal() {
      if (!existsSync(castState)) return [];
      return (JSON.parse(readFileSync(castState, "utf8")) as { journal: string[] }).journal;
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
        JSON.stringify({ config: { chainId: fixture.evmChainId ?? 1001 } }),
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

/** `sendMessage(bytes32,address,string)`: how the fake cast recognises a message being sent. */
export const SEND_MESSAGE_SELECTOR = toFunctionSelector("sendMessage(bytes32,address,string)");

/** The source of the fake cast's handler (it runs in the stub's own process). */
function fakeCastSource(stateFile: string, options: FakeCastOptions): string {
  const lastMessage = encodeAbiParameters([{ type: "string" }], [options.lastMessage ?? "hello"]);
  return `async (args) => {
    const fs = await import("node:fs");
    const config = ${JSON.stringify(options)};
    const file = ${JSON.stringify(stateFile)};
    const status = config.receiptStatus ?? "0x1";
    const load = () =>
      fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { trusted: {}, journal: [] };
    const update = (change) => {
      const state = load();
      change(state);
      fs.writeFileSync(file, JSON.stringify(state));
    };
    const rpcUrl = args[args.indexOf("--rpc-url") + 1];
    const chain = new URL(rpcUrl).pathname.split("/").filter(Boolean)[0];

    if (args[0] === "send" && args.includes("--create")) {
      if (config.deployError) return { err: config.deployError + "\\n", code: 1 };
      if (config.deployDelayMs) await new Promise((r) => setTimeout(r, config.deployDelayMs));
      update((s) => s.journal.push("create " + chain));
      const contractAddress = (config.deploy ?? {})[chain];
      return { out: JSON.stringify({ status, contractAddress, transactionHash: "0x01" }) + "\\n" };
    }

    const split = args.indexOf("--");
    if (split === -1) return { err: "error: positionals must follow --\\n", code: 2 };
    const [to, sig, ...params] = args.slice(split + 1);
    const slot = chain + "|" + String(to).toLowerCase() + "|" + params[0];

    if (args[0] === "send" && sig.startsWith("setTrustedRemote")) {
      update((s) => {
        s.trusted[slot] = params[1];
        s.journal.push("link " + chain);
      });
      return { out: JSON.stringify({ status, transactionHash: "0x02" }) + "\\n" };
    }
    // A message goes out as raw calldata only: its text is never an argument.
    if (args[0] === "send" && sig.startsWith(${JSON.stringify(SEND_MESSAGE_SELECTOR)}) && params.length === 0) {
      update((s) => s.journal.push("send begin " + chain));
      if (config.sendDelayMs) await new Promise((r) => setTimeout(r, config.sendDelayMs));
      update((s) => s.journal.push("send end " + chain));
      return { out: JSON.stringify({ status, transactionHash: "0xfeed" }) + "\\n" };
    }
    if (args[0] === "call" && sig.startsWith("trustedRemote")) {
      if (config.trustedRemoteError) return { err: config.trustedRemoteError + "\\n", code: 1 };
      const remote = load().trusted[slot] ?? "0x0000000000000000000000000000000000000000";
      return { out: remote + "\\n" };
    }
    // ... and comes back as raw ABI bytes only: no return types in the signature.
    if (args[0] === "call" && sig === "lastMessage()") return { out: ${JSON.stringify(lastMessage)} + "\\n" };
    if (args[0] === "call" && sig.startsWith("messagesReceived")) return { out: "3\\n" };
    return { err: "error: unexpected cast invocation\\n", code: 2 };
  }`;
}

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

export interface FakeRpc {
  /** An RPC endpoint for a chain; every `chain` path is served by this one server. */
  url: (chain: string) => string;
  /**
   * Put a contract at `address` on `chain`: `eth_getCode` reports it, and it
   * answers `MAX_MESSAGE_LENGTH()` like a current AvaKitMessenger.
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
  /** Every JSON-RPC method received so far, as "chain:method". */
  seen: string[];
  close: () => Promise<void>;
}

/** `MAX_MESSAGE_LENGTH()`, as `cast sig` prints it. */
const MAX_MESSAGE_LENGTH_SELECTOR = "0x2a027211";

/** A local JSON-RPC endpoint that answers like a running L1 (loopback only). */
export async function startFakeRpc(): Promise<FakeRpc> {
  const code = new Map<string, string>();
  const outdated = new Map<string, { code: number; message: string }>();
  const brokenCode = new Set<string>();
  const brokenCall = new Set<string>();
  const seen: string[] = [];

  /** What the chain answers: a result, or a JSON-RPC error. */
  const answer = (
    chain: string,
    method: string,
    params: unknown[],
  ): { result: string } | { error: { code: number; message: string } } => {
    const busy = { error: { code: -32000, message: "busy" } };
    if (method === "eth_getCode") {
      if (brokenCode.has(chain)) return busy;
      return { result: code.get(`${chain}:${String(params[0]).toLowerCase()}`) ?? "0x" };
    }
    if (method === "eth_call") {
      if (brokenCall.has(chain)) return busy;
      const call = params[0] as { to?: string; data?: string };
      const at = `${chain}:${String(call.to).toLowerCase()}`;
      // Only the cap's getter is implemented; an address without code returns nothing.
      if (!code.has(at) || call.data !== MAX_MESSAGE_LENGTH_SELECTOR) return { result: "0x" };
      const revert = outdated.get(at);
      return revert ? { error: revert } : { result: `0x${(256).toString(16).padStart(64, "0")}` };
    }
    return { result: "0x1" };
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
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, ...answer(chain, method, params) }));
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
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
