/**
 * The action lock across real, separate Studio processes: a dashboard stopped
 * with Ctrl+C (SIGINT) and an MCP server stopped by its client (SIGTERM) while
 * the avalanche-cli command they started is still running, and Interchain
 * deploys and sends, which take the same lock as the avalanche-cli actions.
 *
 * The other Studio process runs straight from the TypeScript sources (see
 * testing/studio-process.mjs), which needs a Node that strips types (22.18+,
 * 23.6+, 24). Everything else is the usual sandbox: a fake HOME, a PATH holding
 * only stubs, and a JSON-RPC endpoint on 127.0.0.1.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { actionLockFile } from "./lock.js";
import { createMcpServer } from "./mcp.js";
import { type StudioServer, startServer } from "./server.js";
import {
  blockchainId,
  createSandbox,
  type FakeRpc,
  type Sandbox,
  startFakeRpc,
} from "./testing/sandbox.js";

const FIXTURE = fileURLToPath(new URL("./testing/studio-process.mjs", import.meta.url));
const RUNS_SOURCES = Boolean((process.features as { typescript?: unknown }).typescript);

const MESSENGER = "0x52C84043CD9c865236f11d9Fc9F56aa003c1f922";

let sandbox: Sandbox;
let rpc: FakeRpc;
let server: StudioServer;
let token: string;
let mcp: Client;
/** Processes a test started: stopped (if still running) after it. */
let started: number[];

beforeEach(async () => {
  sandbox = createSandbox();
  rpc = await startFakeRpc();
  started = [];
  const webDir = path.join(sandbox.home, "web");
  mkdirSync(webDir, { recursive: true });
  writeFileSync(path.join(webDir, "index.html"), "<html><head></head><body></body></html>");
  // This test process is a Studio too: a dashboard and an MCP face.
  server = await startServer({ cwd: sandbox.home, webDir });
  token = await tokenOf(server.url);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(serverSide);
  mcp = new Client({ name: "studio-test", version: "0.0.0" });
  await mcp.connect(clientSide);
});

afterEach(async () => {
  for (const pid of started) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  await mcp.close();
  await server.close();
  await rpc.close();
  sandbox.dispose();
});

async function tokenOf(url: string): Promise<string> {
  const shell = await (await fetch(url)).text();
  return /window\.__AVAKIT_STUDIO__=\{"token":"([0-9a-f]+)"\}/.exec(shell)?.[1] ?? "";
}

/** An authenticated POST to a dashboard (this process's, unless `to` says otherwise). */
async function post(
  pathname: string,
  body: unknown,
  to: { port: number; token: string } = { port: server.port, token },
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${to.port}${pathname}`, {
    method: "POST",
    headers: { "x-studio-token": to.token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function tool(client: Client, name: string): Promise<{ text: string; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: {} })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { text: result.content.map((c) => c.text).join("\n"), isError: Boolean(result.isError) };
}

async function waitFor<T>(read: () => T, ok: (value: T) => boolean, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting; last: ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const journalFile = () => path.join(sandbox.home, "journal");
const goFile = () => path.join(sandbox.home, "go");
const journal = () =>
  existsSync(journalFile()) ? readFileSync(journalFile(), "utf8").split("\n").filter(Boolean) : [];

/**
 * An `avalanche` whose `network start` runs until the test lets it finish, and
 * that notes when each command begins and ends. It prints nothing: the Studio
 * process that started it may be gone, its pipes with it.
 */
function slowAvalanche(): void {
  sandbox.stub(
    "avalanche",
    `async (args) => {
      const fs = await import("node:fs");
      const note = (what) => fs.appendFileSync(${JSON.stringify(journalFile())}, what + " " + args.join(" ") + "\\n");
      note("begin");
      if (args[1] === "start") {
        const deadline = Date.now() + 30000;
        while (!fs.existsSync(${JSON.stringify(goFile())}) && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 20));
        }
      }
      note("end");
      return {};
    }`,
  );
}

/** The lock file as it is now. */
const lock = () =>
  JSON.parse(readFileSync(actionLockFile(), "utf8")) as {
    pid: number;
    action: string;
    command: { pid: number } | null;
  };

/** A second dashboard, in its own process: resolves once it serves. */
async function dashboardProcess(): Promise<{
  child: ChildProcess;
  port: number;
  token: string;
  exited: Promise<void>;
}> {
  const child = spawn(process.execPath, [FIXTURE, "dashboard", path.join(sandbox.home, "web")], {
    cwd: sandbox.home,
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  started.push(child.pid as number);
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const first = await new Promise<string>((resolve, reject) => {
    let out = "";
    child.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      if (out.includes("\n")) resolve(out.split("\n")[0] as string);
    });
    child.once("exit", (code) => reject(new Error(`dashboard process exited (${code})`)));
  });
  const { port, token: theirs } = JSON.parse(first) as { port: number; token: string };
  return { child, port, token: theirs, exited };
}

/** An MCP server in its own process, as an agent's client starts one. */
async function mcpProcess(): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [FIXTURE, "mcp"],
    cwd: sandbox.home,
    env: { HOME: sandbox.home, PATH: process.env.PATH ?? "", AVAKIT_TELEMETRY_DISABLED: "1" },
    stderr: "ignore",
  });
  const client = new Client({ name: "studio-test-agent", version: "0.0.0" });
  await client.connect(transport);
  if (transport.pid !== null) started.push(transport.pid);
  return { client, transport };
}

/** What the refusal says while only the orphaned command holds the lock. */
function orphanRefusal(commandPid: number, studioPid: number): string {
  return (
    `Another action (devnet start) is still running: its avalanche-cli command (pid ${commandPid}) ` +
    `was started by a Studio process (pid ${studioPid}) that has since exited — wait for the command ` +
    `to finish, then retry. If no other Studio and no avalanche-cli command is running, the lock ` +
    `file ${actionLockFile()} is left over: delete it and retry.`
  );
}

describe.skipIf(!RUNS_SOURCES)("an avalanche-cli command that outlives its Studio", () => {
  it("keeps the lock after the dashboard that started it is stopped with Ctrl+C", async () => {
    slowAvalanche();
    const other = await dashboardProcess();
    const otherPid = other.child.pid as number;
    expect((await post("/api/run", { kind: "devnet", action: "start" }, other)).status).toBe(200);
    await waitFor(journal, (j) => j.includes("begin network start"));
    const commandPid = lock().command?.pid as number;
    expect(lock()).toMatchObject({ pid: otherPid, action: "devnet start" });
    expect(commandPid).toEqual(expect.any(Number));
    started.push(commandPid);

    // Ctrl+C: the dashboard goes, the detached command does not.
    other.child.kill("SIGINT");
    await other.exited;
    expect(alive(commandPid)).toBe(true);
    expect(existsSync(actionLockFile())).toBe(true);

    // Another Studio — a dashboard, an agent — is refused until it ends.
    const refused = await post("/api/run", { kind: "devnet", action: "stop" });
    expect(refused.status).toBe(409);
    expect(refused.json.error).toBe(orphanRefusal(commandPid, otherPid));
    expect(refused.json.holder).toMatchObject({ orphanedCommandPid: commandPid });
    const agent = await tool(mcp, "devnet_stop");
    expect(agent).toEqual({ isError: true, text: orphanRefusal(commandPid, otherPid) });
    expect(journal()).toEqual(["begin network start"]);

    writeFileSync(goFile(), "");
    await waitFor(
      () => alive(commandPid),
      (a) => !a,
    );
    expect((await post("/api/run", { kind: "devnet", action: "stop" })).status).toBe(200);
    await waitFor(journal, (j) => j.length === 4);
    // Never two at once: the stop began only after the start had ended.
    expect(journal()).toEqual([
      "begin network start",
      "end network start",
      "begin network stop",
      "end network stop",
    ]);
  });

  it("keeps the lock after the MCP server that started it is stopped with SIGTERM", async () => {
    slowAvalanche();
    const agent = await mcpProcess();
    const agentPid = agent.transport.pid as number;
    const starting = tool(agent.client, "devnet_start").catch(() => null);
    await waitFor(journal, (j) => j.includes("begin network start"));
    const commandPid = lock().command?.pid as number;
    expect(lock()).toMatchObject({ pid: agentPid, action: "devnet start" });
    started.push(commandPid);

    // The agent's client stops the server half-way through the action.
    process.kill(agentPid, "SIGTERM");
    await waitFor(
      () => alive(agentPid),
      (a) => !a,
    );
    await starting;
    expect(alive(commandPid)).toBe(true);

    const refused = await post("/api/run", { kind: "devnet", action: "stop" });
    expect(refused.status).toBe(409);
    expect(refused.json.error).toBe(orphanRefusal(commandPid, agentPid));
    expect((await tool(mcp, "devnet_stop")).isError).toBe(true);
    expect(journal()).toEqual(["begin network start"]);

    writeFileSync(goFile(), "");
    await waitFor(
      () => alive(commandPid),
      (a) => !a,
    );
    expect((await tool(mcp, "devnet_stop")).isError).toBe(false);
    expect(journal()).toEqual([
      "begin network start",
      "end network start",
      "begin network stop",
      "end network stop",
    ]);
    await agent.client.close().catch(() => {});
  });

  it("is given back when a Studio stops after its command has ended", async () => {
    // The everyday case must not leave a lock behind.
    sandbox.stub("avalanche", '() => ({ out: "ok\\n" })');
    const other = await dashboardProcess();
    expect((await post("/api/run", { kind: "devnet", action: "stop" }, other)).status).toBe(200);
    await waitFor(
      () => existsSync(actionLockFile()),
      (e) => !e,
    );
    other.child.kill("SIGINT");
    await other.exited;
    expect(existsSync(actionLockFile())).toBe(false);
  });
});

/** Two running, ICM-ready local L1s whose messengers deploy slowly. */
function twoChains(deployDelayMs = 0): void {
  sandbox.addL1("chain1", {
    local: { rpcUrl: rpc.url("chain1"), blockchainId: blockchainId(1).cb58 },
  });
  sandbox.addL1("chain2", {
    local: { rpcUrl: rpc.url("chain2"), blockchainId: blockchainId(2).cb58 },
  });
  rpc.setCode("chain1", MESSENGER);
  rpc.setCode("chain2", MESSENGER);
  sandbox.fakeCast({ deploy: { chain1: MESSENGER, chain2: MESSENGER }, deployDelayMs });
}

const DEPLOY_JOURNAL = ["create chain1", "create chain2", "link chain1", "link chain2"];

describe("Interchain deploys and sends take the action lock", () => {
  it.skipIf(!RUNS_SOURCES)(
    "runs one of two simultaneous deploys from two Studio processes, and refuses the other",
    async () => {
      twoChains(600);
      const agent = await mcpProcess();
      const [dashboard, mcpReply] = await Promise.all([
        post("/api/icm/deploy", {}),
        tool(agent.client, "icm_deploy_messengers"),
      ]);
      await agent.client.close().catch(() => {});

      const wins = [dashboard.status === 200, !mcpReply.isError].filter(Boolean);
      expect(wins).toHaveLength(1);
      const refusal = dashboard.status === 200 ? mcpReply.text : String(dashboard.json.error);
      if (dashboard.status !== 200) expect(dashboard.status).toBe(409);
      expect(refusal).toMatch(
        /^Another action \(icm deploy\) is still running in another Studio process \(pid \d+\) — wait for it to finish, then retry\. If no other Studio and no avalanche-cli command is running, the lock file .+ is left over: delete it and retry\.$/,
      );
      // Nothing was deployed or linked twice.
      expect(sandbox.castJournal()).toEqual(DEPLOY_JOURNAL);
      expect(existsSync(actionLockFile())).toBe(false);
    },
  );

  it("refuses a send or a deploy while a devnet action runs, and a devnet action while a deploy runs", async () => {
    twoChains();
    sandbox.writeIcmState({ chain1: MESSENGER, chain2: MESSENGER });
    slowAvalanche();
    expect((await post("/api/run", { kind: "devnet", action: "start" })).status).toBe(200);
    await waitFor(journal, (j) => j.includes("begin network start"));

    const busy =
      "Another action (devnet start) is still running — wait for it to finish, then retry.";
    const send = await post("/api/icm/send", { from: "chain1", to: "chain2", message: "hi" });
    expect(send).toMatchObject({ status: 409, json: { error: busy } });
    expect(await post("/api/icm/deploy", {})).toMatchObject({ status: 409, json: { error: busy } });
    expect(await tool(mcp, "icm_deploy_messengers")).toEqual({ isError: true, text: busy });
    expect(sandbox.calls("cast")).toEqual([]);

    writeFileSync(goFile(), "");
    await waitFor(
      () => existsSync(actionLockFile()),
      (e) => !e,
    );

    // The other way round: a deploy in flight refuses a devnet action.
    sandbox.writeIcmState({});
    twoChains(800);
    const deploying = post("/api/icm/deploy", {});
    await waitFor(
      () => (existsSync(actionLockFile()) ? lock().action : null),
      (a) => a === "icm deploy",
    );
    const refused = await post("/api/run", { kind: "devnet", action: "stop" });
    expect(refused.status).toBe(409);
    expect(refused.json.error).toBe(
      "Another action (icm deploy) is still running — wait for it to finish, then retry.",
    );
    expect((await deploying).status).toBe(200);
    expect(sandbox.castJournal()).toEqual(DEPLOY_JOURNAL);
    // The refused stop was never spawned.
    expect(journal()).toEqual(["begin network start", "end network start"]);
  });
});
