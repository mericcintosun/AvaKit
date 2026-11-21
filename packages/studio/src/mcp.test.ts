import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { decodeFunctionData, parseAbi } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EWOQ_ADDRESS } from "./devkey.js";
import { createMcpServer } from "./mcp.js";
import { SEND_MESSAGE_SIG } from "./messenger-artifact.js";
import {
  blockchainId,
  createSandbox,
  type FakeRpc,
  type Sandbox,
  SEND_MESSAGE_SELECTOR,
  startFakeRpc,
} from "./testing/sandbox.js";

const MESSENGER = "0x52C84043CD9c865236f11d9Fc9F56aa003c1f922";

let sandbox: Sandbox;
let rpc: FakeRpc;
let client: Client;

beforeEach(async () => {
  sandbox = createSandbox();
  rpc = await startFakeRpc();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(serverSide);
  client = new Client({ name: "studio-test", version: "0.0.0" });
  await client.connect(clientSide);
});

afterEach(async () => {
  await client.close();
  await rpc.close();
  sandbox.dispose();
});

interface ToolReply {
  text: string;
  isError: boolean;
}

/** Call a tool; a rejected call (bad arguments) is reported the same way as a tool error. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolReply> {
  try {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };
    return { text: result.content.map((c) => c.text).join("\n"), isError: Boolean(result.isError) };
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true };
  }
}

/** Two running L1s with live, recorded messengers. */
function deployedDevnet(): void {
  sandbox.addL1("chain1", {
    local: { rpcUrl: rpc.url("chain1"), blockchainId: blockchainId(1).cb58 },
  });
  sandbox.addL1("chain2", {
    local: { rpcUrl: rpc.url("chain2"), blockchainId: blockchainId(2).cb58 },
  });
  rpc.setCode("chain1", MESSENGER);
  rpc.setCode("chain2", MESSENGER);
  sandbox.writeIcmState({ chain1: MESSENGER, chain2: MESSENGER });
}

describe("MCP tools", () => {
  it("registers exactly the tools the README lists", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "avalanche_env",
        "data_lookup",
        "devnet_launch_l1",
        "devnet_spin_up",
        "devnet_start",
        "devnet_status",
        "devnet_stop",
        "icm_deploy_messengers",
        "icm_send",
        "icm_state",
      ].sort(),
    );

    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const listed = /^Tools: (.+)\.$/m.exec(readme)?.[1] ?? "";
    expect([...listed.matchAll(/`([a-z_0-9]+)`/g)].map((m) => m[1]).sort()).toEqual(names);
  });

  it("labels every tool that drives Avalanche CLI experimental, and tells the agent why", async () => {
    const titles = Object.fromEntries(
      (await client.listTools()).tools.map((t) => [t.name, t.title ?? ""]),
    );
    for (const [name, title] of Object.entries(titles)) {
      const drivesCli = /^(devnet|icm)_/.test(name);
      expect(title.endsWith(" (experimental)"), name).toBe(drivesCli);
    }
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toMatch(/^The devnet_\* and icm_\* tools are experimental/);
    expect(instructions).toMatch(/maintenance mode since December 2025/);
    expect(instructions).toMatch(/keeps running after this server stops; devnet_stop/);
  });

  it("icm_send applies the same checks as the dashboard, and sends nothing it refuses", async () => {
    deployedDevnet();
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ from: "chain1", to: "chain2", message: "--help" }, /cannot start with '-'/],
      [{ from: "chain1", to: "chain2", message: "--async" }, /cannot start with '-'/],
      [{ from: "chain1", to: "chain2", message: "-1" }, /cannot start with '-'/],
      [{ from: "chain1", to: "chain1", message: "gm" }, /two different chains/],
      [{ from: "chain1", to: "chain2", message: "" }, /message|too_small|at least/i],
      [{ from: "chain1", to: "chain2", message: "x".repeat(300) }, /256/],
      // 100 three-byte characters: short enough for the schema, too long in bytes.
      [{ from: "chain1", to: "chain2", message: "山".repeat(100) }, /300 bytes/],
      [{ from: "chain1", to: "nosuch", message: "gm" }, /unknown chain: nosuch/],
    ];
    for (const [args, expected] of cases) {
      const reply = await call("icm_send", args);
      expect(reply.isError, JSON.stringify(args).slice(0, 60)).toBe(true);
      expect(reply.text).toMatch(expected);
    }
    expect(rpc.transactions()).toEqual([]);
  });

  it("icm_send sends a valid message as calldata, signed with the EWOQ key", async () => {
    deployedDevnet();
    // Starts with a quote, which a command-line parser would read as a string literal.
    const message = '"gm" agents';
    const reply = await call("icm_send", { from: "chain1", to: "chain2", message });
    expect(reply.isError).toBe(false);
    const result = JSON.parse(reply.text) as { txHash: string; receivedBefore: number };
    expect(result).toEqual({
      txHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      receivedBefore: 3,
    });

    const sent = rpc.transactions().find((tx) => tx.data.startsWith(SEND_MESSAGE_SELECTOR));
    expect(sent).toMatchObject({
      chain: "chain1",
      from: EWOQ_ADDRESS,
      to: MESSENGER.toLowerCase(),
    });
    const { args } = decodeFunctionData({
      abi: parseAbi([`function ${SEND_MESSAGE_SIG}`]),
      data: sent?.data as `0x${string}`,
    });
    expect(args[2]).toBe(message);
  });

  it("icm_send refuses a messenger from before the message-length cap", async () => {
    deployedDevnet();
    rpc.setOutdated("chain2", MESSENGER);
    const reply = await call("icm_send", { from: "chain1", to: "chain2", message: "gm" });
    expect(reply.isError).toBe(true);
    expect(reply.text).toBe("deploy the messengers first");
    expect(rpc.transactions()).toEqual([]);
  });

  it("icm_state lists only the L1s that can exchange a message", async () => {
    deployedDevnet();
    sandbox.addL1("myfujil1", {
      fuji: { rpcUrl: rpc.url("myfujil1"), blockchainId: blockchainId(3).cb58 },
    });
    interface State {
      ready: boolean;
      hasPeers: boolean;
      chains: { name: string; messenger: string | null }[];
      maxMessageBytes: number;
    }
    const state = JSON.parse((await call("icm_state")).text) as State;
    expect(state.chains.map((c) => c.name)).toEqual(["chain1", "chain2"]);
    expect(state.maxMessageBytes).toBe(256);
    // The messengers are there but not linked yet: two L1s, not yet "ready".
    expect(state.hasPeers).toBe(true);
    expect(state.ready).toBe(false);

    const linked = JSON.parse((await call("icm_deploy_messengers")).text) as State;
    expect(linked.ready).toBe(true);
    expect((JSON.parse((await call("icm_state")).text) as State).ready).toBe(true);
  });

  it("icm_state does not call a devnet without messengers ready", async () => {
    // What an agent used to get: `ready: true`, then "deploy the messengers first".
    sandbox.addL1("chain1", {
      local: { rpcUrl: rpc.url("chain1"), blockchainId: blockchainId(1).cb58 },
    });
    sandbox.addL1("chain2", {
      local: { rpcUrl: rpc.url("chain2"), blockchainId: blockchainId(2).cb58 },
    });
    const state = JSON.parse((await call("icm_state")).text) as {
      ready: boolean;
      hasPeers: boolean;
      chains: { messenger: string | null }[];
    };
    expect(state.chains.map((c) => c.messenger)).toEqual([null, null]);
    expect(state).toMatchObject({ ready: false, hasPeers: true });
    const send = await call("icm_send", { from: "chain1", to: "chain2", message: "gm" });
    expect(send).toEqual({ text: "deploy the messengers first", isError: true });

    const tools = (await client.listTools()).tools;
    expect(tools.find((t) => t.name === "icm_state")?.description).toMatch(
      /`ready` is true only when two of them have a usable messenger and those messengers are linked/,
    );
  });

  it("devnet_launch_l1 rejects values that are not whitelisted", async () => {
    sandbox.stub("avalanche", '() => ({ out: "ok\\n" })');
    for (const args of [
      { name: "--force", chainId: "9999", token: "MYL1" },
      { name: "mychain", chainId: "0x10", token: "MYL1" },
      { name: "mychain", chainId: "9999", token: "--icm" },
    ]) {
      expect((await call("devnet_launch_l1", args)).isError).toBe(true);
    }
    expect(sandbox.calls("avalanche")).toEqual([]);

    const ok = await call("devnet_launch_l1", { name: "mychain", chainId: "9999" });
    expect(ok.isError).toBe(false);
    expect(sandbox.calls("avalanche").map((a) => a.slice(0, 3).join(" "))).toEqual([
      "blockchain create mychain",
      "blockchain deploy mychain",
    ]);
    // The default token symbol was applied.
    expect(sandbox.calls("avalanche")[0]).toContain("MYL1");
  });

  it("devnet_launch_l1 refuses to pass an existing chain off as the one asked for", async () => {
    sandbox.stub("avalanche", '() => ({ out: "ok\\n" })');
    sandbox.addL1("gatel2", { evmChainId: 9999, token: "OLD" });

    const refused = await call("devnet_launch_l1", {
      name: "gatel2",
      chainId: "4242",
      token: "NEW",
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(
      /^An L1 config named "gatel2" already exists with chain ID 9999 and token OLD — not the requested chain ID 4242 and token NEW\./,
    );
    expect(sandbox.calls("avalanche")).toEqual([]);

    // Asked for as it is, the existing chain is reused — and the log says so.
    const reused = await call("devnet_launch_l1", {
      name: "gatel2",
      chainId: "9999",
      token: "OLD",
    });
    expect(reused.isError).toBe(false);
    expect(JSON.parse(reused.text)).toEqual({
      exitCode: 0,
      tail: [
        "↳ using the existing config for gatel2 (chain ID 9999 and token OLD) — not creating it again",
        "$ avalanche blockchain deploy gatel2 --local",
        "ok",
      ],
    });
  });

  it("runs one avalanche-cli action at a time", async () => {
    sandbox.stub(
      "avalanche",
      'async () => { await new Promise((r) => setTimeout(r, 400)); return { out: "ok\\n" }; }',
    );
    const [first, second] = await Promise.all([call("devnet_start"), call("devnet_stop")]);
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(true);
    // Word for word what the dashboard answers (apart from its "or cancel it").
    expect(second.text).toBe(
      "Another action (devnet start) is still running — wait for it to finish, then retry.",
    );
    expect(sandbox.calls("avalanche")).toEqual([["network", "start"]]);

    // Free again once the first has finished.
    expect((await call("devnet_stop")).isError).toBe(false);
  });

  it("reports a failed action as an error with the log tail", async () => {
    sandbox.stub("avalanche", '() => ({ err: "Error: no network to stop\\n", code: 1 })');
    const reply = await call("devnet_stop");
    expect(reply.isError).toBe(true);
    expect(JSON.parse(reply.text)).toMatchObject({
      exitCode: 1,
      tail: ["$ avalanche network stop", "Error: no network to stop", "✖ exited with code 1"],
    });
  });
});
