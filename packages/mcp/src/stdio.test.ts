/**
 * Stdio discipline. Over stdio, stdout *is* the protocol: one JSON-RPC message
 * per line and nothing else. A banner, a progress line or a stray console.log
 * there and the client drops the connection.
 *
 * The server is put on a stdio transport here exactly as `index.ts` does, with
 * two in-memory streams standing in for the process's own, and is driven with
 * hand-written JSON-RPC — no client library on this side.
 */

import { PassThrough } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeNetwork } from "./testing/network.js";

interface Message {
  jsonrpc: string;
  id?: number;
  result?: Record<string, unknown>;
  error?: unknown;
}

let stdin: PassThrough;
/** Every line the server wrote to its output, as written. */
let lines: string[];
let waiting: Map<number, (message: Message) => void>;
let net: FakeNetwork;
let processStdout: string[];
let processStderr: string[];
let close: () => Promise<void>;

function send(message: Record<string, unknown>): void {
  stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function request(id: number, method: string, params?: Record<string, unknown>): Promise<Message> {
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    send({ id, method, ...(params ? { params } : {}) });
  });
}

const callTool = (id: number, name: string, args: Record<string, unknown> = {}) =>
  request(id, "tools/call", { name, arguments: args });

beforeEach(async () => {
  vi.resetModules();
  const network = await import("./testing/network.js");
  net = network.fakeNetwork();
  network.fakeClock();
  // Whatever the machine running the tests has set, this server starts with none of it.
  for (const variable of [
    "AVAKIT_DEPLOYER_KEY",
    "AVAKIT_TEST_WALLET",
    "AVAKIT_ALLOW_MAINNET",
    "AVAKIT_FAUCET_URL",
    "AVAKIT_MCP_ROOT",
  ]) {
    vi.stubEnv(variable, "");
  }

  processStdout = [];
  processStderr = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    processStdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    processStderr.push(String(chunk));
    return true;
  });
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => {
      processStdout.push(`console.${method}: ${args.join(" ")}`);
    });
  }

  stdin = new PassThrough();
  const stdout = new PassThrough();
  lines = [];
  waiting = new Map();
  let buffered = "";
  stdout.on("data", (chunk: Buffer) => {
    buffered += chunk.toString("utf8");
    for (;;) {
      const end = buffered.indexOf("\n");
      if (end === -1) break;
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      lines.push(line);
      try {
        const message = JSON.parse(line) as Message;
        if (typeof message.id === "number") waiting.get(message.id)?.(message);
      } catch {
        // Not a frame. The assertions below are what report it.
      }
    }
  });

  const { server } = await import("./server.js");
  await server.connect(new StdioServerTransport(stdin, stdout));
  close = () => server.close();
});
afterEach(async () => {
  await close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the server on stdio", () => {
  it("answers initialize and tools/list with protocol frames and nothing else", async () => {
    const initialized = await request(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "hand-written", version: "0.0.0" },
    });
    expect(initialized.result).toMatchObject({
      serverInfo: { name: "avakit-mcp" },
      capabilities: { tools: {} },
    });
    send({ method: "notifications/initialized" });

    const listed = await request(2, "tools/list");
    const tools = listed.result?.tools as { name: string }[];
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "deploy_contract",
      "estimate_gas",
      "get_context",
      "list_templates",
      "read_chain",
      "scaffold_app",
      "wallet_status",
      "write_contract",
    ]);

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(JSON.parse(line)).toMatchObject({ jsonrpc: "2.0" });
    }
    // The process's real stdout was never written to.
    expect(processStdout).toEqual([]);
  });

  it("keeps its output to protocol frames while a wallet is made, funded and used", async () => {
    await request(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "hand-written", version: "0.0.0" },
    });
    send({ method: "notifications/initialized" });

    // The calls that have something to say on the side: creating the session
    // wallet, asking the faucet, a faucet refusal, a failed validation.
    const status = await callTool(2, "wallet_status");
    const deployed = await callTool(3, "deploy_contract", { abi: [], bytecode: "0x6080" });
    const address = net.fuji.sent[0]?.created;
    const minted = await callTool(4, "write_contract", {
      address,
      abi: ["function mint()"],
      functionName: "mint",
    });
    net.fuji.setBalance(net.fuji.sent[0]?.from ?? "", 0n);
    net.faucet.script = [{ status: 503, body: { code: "faucet_empty" } }];
    const refused = await callTool(5, "deploy_contract", { abi: [], bytecode: "0x6080" });
    const invalid = await callTool(6, "write_contract", { address: "nope" });

    for (const [message, isError] of [
      [status, false],
      [deployed, false],
      [minted, false],
      [refused, true],
      [invalid, true],
    ] as const) {
      expect(message.error).toBeUndefined();
      expect(Boolean(message.result?.isError)).toBe(isError);
    }

    // Six requests, six lines, every one a JSON-RPC response to one of them.
    expect(lines).toHaveLength(6);
    expect(lines.map((line) => (JSON.parse(line) as Message).id)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const line of lines) {
      const message = JSON.parse(line) as Message;
      expect(message.jsonrpc).toBe("2.0");
      expect(Object.keys(message).sort()).toEqual(["id", "jsonrpc", "result"]);
    }
    expect(processStdout).toEqual([]);

    // What it had to say on the side went to stderr, a line at a time.
    expect(processStderr.length).toBeGreaterThanOrEqual(3);
    expect(processStderr[0]).toMatch(
      /^avakit-mcp: created a session test wallet, 0x[0-9a-fA-F]{40}: /,
    );
    for (const line of processStderr) {
      expect(line).toMatch(/^avakit-mcp: [^\n]*\n$/);
    }
  });
});
