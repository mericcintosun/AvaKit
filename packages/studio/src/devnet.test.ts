import { mkdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  devnetStillRunning,
  existingL1Config,
  getDevnetStatus,
  isDevnetAction,
  isValidChainId,
  isValidL1Name,
  isValidL1Params,
  isValidToken,
  l1ConfigConflict,
  runDevnetAction,
  runDevnetActionAsync,
} from "./devnet.js";
import {
  blockchainId,
  createSandbox,
  type FakeRpc,
  type Sandbox,
  startFakeRpc,
} from "./testing/sandbox.js";

describe("argument validators", () => {
  it("isValidL1Name accepts only short lowercase alphanumeric names", () => {
    for (const ok of ["ab", "chain1", "mychain", `a${"b".repeat(31)}`]) {
      expect(isValidL1Name(ok), ok).toBe(true);
    }
    for (const bad of [
      "",
      "a",
      "1chain",
      "Chain",
      "my-chain",
      "my_chain",
      "my chain",
      "--force",
      "-x",
      "../etc",
      "a/b",
      "a.b",
      "chain1\n",
      "chain1;rm",
      `a${"b".repeat(32)}`,
    ]) {
      expect(isValidL1Name(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("isValidToken accepts 1–8 upper-case alphanumerics starting with a letter", () => {
    for (const ok of ["A", "AVAX", "TOK1", "ABCDEFGH"]) expect(isValidToken(ok), ok).toBe(true);
    for (const bad of ["", "avax", "1TOK", "ABCDEFGHI", "TO-K", "--x", "TOK ", "TOK\n"]) {
      expect(isValidToken(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("isValidChainId accepts 1–4294967295 in plain decimal", () => {
    for (const ok of ["1", "9999", "43113", "4294967295"]) {
      expect(isValidChainId(ok), ok).toBe(true);
    }
    for (const bad of [
      "",
      "0",
      "01",
      "-1",
      "1.5",
      "1e3",
      "0x10",
      "4294967296",
      "99999999999",
      " 1",
    ]) {
      expect(isValidChainId(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("isValidL1Params needs all three to be valid strings", () => {
    expect(isValidL1Params({ name: "mychain", chainId: "9999", token: "MYL1" })).toBe(true);
    expect(isValidL1Params({ name: "mychain", chainId: "9999" })).toBe(false);
    expect(isValidL1Params({ name: "--force", chainId: "9999", token: "MYL1" })).toBe(false);
    expect(isValidL1Params({ name: "mychain", chainId: "0", token: "MYL1" })).toBe(false);
    expect(isValidL1Params({ name: "mychain", chainId: "9999", token: "myl1" })).toBe(false);
    // Not strings at all (a JSON body can carry anything).
    expect(isValidL1Params({ name: 1, chainId: 2, token: 3 } as never)).toBe(false);
  });

  it("isDevnetAction knows the four actions", () => {
    for (const ok of ["start", "stop", "create-icm", "create-l1"]) {
      expect(isDevnetAction(ok)).toBe(true);
    }
    expect(isDevnetAction("network clean")).toBe(false);
    expect(isDevnetAction("")).toBe(false);
  });
});

describe("devnet status and actions", () => {
  let sandbox: Sandbox;
  let rpc: FakeRpc;
  beforeEach(async () => {
    sandbox = createSandbox();
    rpc = await startFakeRpc();
  });
  afterEach(async () => {
    await rpc.close();
    sandbox.dispose();
  });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("reads status from avalanche-cli's files and probes the local RPC", async () => {
    sandbox.addL1("chain1", {
      local: { rpcUrl: rpc.url("chain1"), blockchainId: blockchainId(1).cb58 },
      evmChainId: 1001,
      token: "TOK1",
    });
    // Deployed locally once, but nothing answers on its RPC any more.
    sandbox.addL1("stale", {
      local: { rpcUrl: "http://127.0.0.1:9/dead/rpc", blockchainId: blockchainId(2).cb58 },
    });
    // Only ever deployed to Fuji: not a local deployment at all.
    sandbox.addL1("myfujil1", {
      fuji: { rpcUrl: rpc.url("myfujil1"), blockchainId: blockchainId(3).cb58 },
    });

    const status = await getDevnetStatus();
    expect(status.running).toBe(true);
    expect(status.l1s.map((l) => [l.name, l.deployed, l.running])).toEqual([
      ["chain1", true, true],
      ["myfujil1", false, false],
      ["stale", true, false],
    ]);
    expect(status.l1s[0]).toMatchObject({
      evmChainId: 1001,
      token: "TOK1",
      teleporterReady: true,
      blockchainId: blockchainId(1).cb58,
      rpcUrl: rpc.url("chain1"),
    });
  });

  it("reports no L1s when avalanche-cli has never been used", async () => {
    expect(await getDevnetStatus()).toEqual({ running: false, l1s: [] });
  });

  it("spin-up creates only the missing L1s and deploys both", async () => {
    sandbox.addL1("chain1");
    sandbox.stub("avalanche", '() => ({ out: "ok\\n" })');
    const { exitCode } = await runDevnetActionAsync("create-icm");
    expect(exitCode).toBe(0);
    expect(sandbox.calls("avalanche").map((a) => a.slice(0, 3).join(" "))).toEqual([
      "blockchain create chain2",
      "blockchain deploy chain1",
      "blockchain deploy chain2",
    ]);
  });

  it("builds the create-l1 command from the validated values only", async () => {
    sandbox.stub("avalanche", '() => ({ out: "ok\\n" })');
    const { exitCode } = await runDevnetActionAsync("create-l1", {
      name: "mychain",
      chainId: "9999",
      token: "MYL1",
    });
    expect(exitCode).toBe(0);
    expect(sandbox.calls("avalanche")).toEqual([
      [
        "blockchain",
        "create",
        "mychain",
        "--evm",
        "--latest",
        "--evm-chain-id",
        "9999",
        "--evm-token",
        "MYL1",
        "--test-defaults",
        "--sovereign=false",
      ],
      ["blockchain", "deploy", "mychain", "--local"],
    ]);
  });

  it("refuses to build a create-l1 command from unvalidated values", async () => {
    sandbox.stub("avalanche", '() => ({ out: "ok\\n" })');
    await expect(
      runDevnetActionAsync("create-l1", { name: "--force", chainId: "9999", token: "MYL1" }),
    ).rejects.toThrow(/validated params/);
    await expect(runDevnetActionAsync("create-l1")).rejects.toThrow(/validated params/);
    expect(sandbox.calls("avalanche")).toEqual([]);
  });

  it("continues past a deploy that only says the blockchain is already deployed", async () => {
    sandbox.addL1("chain1");
    sandbox.addL1("chain2");
    sandbox.stub(
      "avalanche",
      `(args) => {
        const name = args[2];
        // avalanche-cli prints this progress line on every local deploy after the first.
        return {
          out: "ICM Messenger has already been deployed to C-Chain\\n",
          err: "Error: blockchain " + name + " has already been deployed\\n",
          code: 1,
        };
      }`,
    );
    const { exitCode, log } = await runDevnetActionAsync("create-icm");
    expect(exitCode).toBe(0);
    expect(log.filter((l) => l === "↳ already in place — continuing")).toHaveLength(2);
  });

  it("refuses create-l1 when a config with that name has another chain ID or token", async () => {
    // It used to skip the create, deploy the old chain, and end with exit 0 —
    // "Your L1 is live" for a chain that has neither the new ID nor the new token.
    sandbox.addL1("gatel2", { evmChainId: 9999, token: "OLD" });
    sandbox.stub("avalanche", '() => ({ out: "ok\\n" })');
    const requested = { name: "gatel2", chainId: "4242", token: "NEW" };

    expect(existingL1Config("gatel2")).toEqual({ evmChainId: 9999, token: "OLD" });
    const conflict = l1ConfigConflict(requested);
    expect(conflict).toBe(
      'An L1 config named "gatel2" already exists with chain ID 9999 and token OLD — ' +
        "not the requested chain ID 4242 and token NEW. " +
        "Choose another name, ask for the existing values to reuse that config, or delete it " +
        "yourself (avalanche blockchain delete gatel2) and try again.",
    );
    // One differing value is enough.
    expect(l1ConfigConflict({ ...requested, chainId: "9999" })).toMatch(/token OLD/);
    expect(l1ConfigConflict({ ...requested, token: "OLD" })).toMatch(/chain ID 9999/);

    // The command builder refuses too, whoever calls it.
    await expect(runDevnetActionAsync("create-l1", requested)).rejects.toThrow(conflict as string);
    expect(sandbox.calls("avalanche")).toEqual([]);
  });

  it("reuses an existing config that is the one asked for, and says so in the log", async () => {
    sandbox.addL1("gatel2", { evmChainId: 9999, token: "OLD" });
    sandbox.stub("avalanche", '() => ({ out: "ok\\n" })');
    const requested = { name: "gatel2", chainId: "9999", token: "OLD" };
    expect(l1ConfigConflict(requested)).toBeNull();

    const { exitCode, log } = await runDevnetActionAsync("create-l1", requested);
    expect(exitCode).toBe(0);
    expect(log).toEqual([
      "↳ using the existing config for gatel2 (chain ID 9999 and token OLD) — not creating it again",
      "$ avalanche blockchain deploy gatel2 --local",
      "ok",
    ]);
    expect(sandbox.calls("avalanche")).toEqual([["blockchain", "deploy", "gatel2", "--local"]]);
  });

  it("does not take a config it cannot read for the chain that was asked for", () => {
    // A directory avalanche-cli left without a genesis or a sidecar.
    mkdirSync(path.join(sandbox.home, ".avalanche-cli", "subnets", "halfmade"), {
      recursive: true,
    });
    expect(existingL1Config("halfmade")).toEqual({ evmChainId: null, token: null });
    expect(l1ConfigConflict({ name: "halfmade", chainId: "9999", token: "MYL1" })).toMatch(
      /already exists with an unreadable chain ID and an unreadable token/,
    );
    // No config at all: nothing in the way.
    expect(existingL1Config("brandnew")).toBeNull();
    expect(l1ConfigConflict({ name: "brandnew", chainId: "9999", token: "MYL1" })).toBeNull();
  });

  it("spin-up says which existing L1 it reuses", async () => {
    sandbox.addL1("chain1", { evmChainId: 1001, token: "TOK1" });
    sandbox.stub("avalanche", '() => ({ out: "ok\\n" })');
    const { log } = await runDevnetActionAsync("create-icm");
    expect(log.filter((l) => l.startsWith("↳"))).toEqual([
      "↳ using the existing config for chain1 (chain ID 1001 and token TOK1) — not creating it again",
    ]);
  });

  it("does not let an informational 'already deployed' line hide a real failure", async () => {
    sandbox.addL1("chain1");
    sandbox.addL1("chain2");
    sandbox.stub(
      "avalanche",
      `() => ({
        out: "ICM Messenger has already been deployed to C-Chain\\n",
        err: "Error: failed to start relayer: exit status 1\\n",
        code: 1,
      })`,
    );
    const { exitCode, log } = await runDevnetActionAsync("create-icm");
    expect(exitCode).toBe(1);
    expect(log.at(-1)).toBe("✖ exited with code 1");
    // It stopped at the first deploy.
    expect(sandbox.calls("avalanche")).toHaveLength(1);
  });

  it("does not treat an unrelated 'is already' error as success", async () => {
    sandbox.stub(
      "avalanche",
      '() => ({ err: "Error: port 9650 is already in use by another process\\n", code: 1 })',
    );
    const { exitCode, log } = await runDevnetActionAsync("start");
    expect(exitCode).toBe(1);
    expect(log).not.toContain("↳ already in place — continuing");
  });

  it("treats 'the network is already running' as the state start was asked for", async () => {
    sandbox.stub("avalanche", '() => ({ err: "Error: network is already running\\n", code: 1 })');
    expect((await runDevnetActionAsync("start")).exitCode).toBe(0);
  });

  it("reports a missing avalanche-cli once and emits nothing afterwards", async () => {
    // No stub installed: the spawn fails with ENOENT (`error`, then `close`).
    const lines: string[] = [];
    const exits: number[] = [];
    let linesAtFirstDone = -1;
    runDevnetAction(
      "start",
      (line) => lines.push(line),
      (code) => {
        exits.push(code);
        if (linesAtFirstDone === -1) linesAtFirstDone = lines.length;
      },
    );
    await sleep(300);
    expect(exits).toEqual([1]);
    expect(lines).toEqual([
      "$ avalanche network start",
      "error: avalanche is not installed or not on your PATH",
    ]);
    expect(lines.length).toBe(linesAtFirstDone);
  });

  it("never asks a 'local' RPC URL that points to another machine", async () => {
    // A hand-edited config: its local network entry names a documentation address.
    sandbox.addL1("elsewhere", {
      local: { rpcUrl: "http://203.0.113.7:9650/ext/bc/x/rpc", blockchainId: blockchainId(9).cb58 },
    });
    const realFetch = globalThis.fetch;
    const asked: string[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      asked.push(String(input));
      if (String(input).includes("203.0.113.7")) throw new Error("must never be asked");
      return realFetch(input, init);
    });
    try {
      const status = await getDevnetStatus();
      expect(status.l1s.map((l) => [l.name, l.deployed, l.running])).toEqual([
        ["elsewhere", true, false],
      ]);
      expect(await devnetStillRunning()).toEqual([]);
      expect(asked).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("what Studio says about the local network when it stops", () => {
  let sandbox: Sandbox;
  let rpc: FakeRpc;
  beforeEach(async () => {
    sandbox = createSandbox();
    rpc = await startFakeRpc();
  });
  afterEach(async () => {
    await rpc.close();
    sandbox.dispose();
  });

  it("names the local L1s that still answer, and how to stop the network", async () => {
    sandbox.addL1("chain1", {
      local: { rpcUrl: rpc.url("chain1"), blockchainId: blockchainId(1).cb58 },
    });
    sandbox.addL1("chain2", {
      local: { rpcUrl: rpc.url("chain2"), blockchainId: blockchainId(2).cb58 },
    });
    // Deployed once; nothing answers on its RPC any more.
    sandbox.addL1("stale", {
      local: { rpcUrl: "http://127.0.0.1:9/dead/rpc", blockchainId: blockchainId(3).cb58 },
    });
    expect(await devnetStillRunning()).toEqual([
      "The local Avalanche network keeps running. Studio leaves it up on purpose, because your apps and other tools may be using it:",
      `  chain1  ${rpc.url("chain1")}`,
      `  chain2  ${rpc.url("chain2")}`,
      "Stop it with: avalanche network stop   (its state is kept: avalanche network start brings it back)",
    ]);
  });

  it("says nothing when no local L1 answers", async () => {
    sandbox.addL1("stale", {
      local: { rpcUrl: "http://127.0.0.1:9/dead/rpc", blockchainId: blockchainId(3).cb58 },
    });
    expect(await devnetStillRunning()).toEqual([]);
  });

  it("prints no control characters from avalanche-cli's files to the terminal", async () => {
    // The query string reaches the RPC percent-encoded; the file holds it raw.
    const rpcUrl = `${rpc.url("chain1")}?x=\u001b[2J\u0007`;
    sandbox.addL1("chain1", { local: { rpcUrl, blockchainId: blockchainId(1).cb58 } });
    const lines = await devnetStillRunning();
    expect(lines[1]).toBe(`  chain1  ${rpc.url("chain1")}?x=[2J`);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: looking for them is the point
    expect(lines.join("\n")).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
  });
});
