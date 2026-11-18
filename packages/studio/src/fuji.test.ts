import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputError } from "./errors.js";
import {
  ensureFujiKey,
  getFujiKeyBalance,
  getFujiL1,
  isFujiAction,
  isValidAmount,
  prepareFujiAction,
} from "./fuji.js";
import {
  blockchainId,
  createSandbox,
  type FakeRpc,
  type Sandbox,
  startFakeRpc,
} from "./testing/sandbox.js";

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = createSandbox();
});
afterEach(() => {
  vi.unstubAllGlobals();
  sandbox.dispose();
});

/** A throwaway key generated for this test run only — never a real one. */
function throwawayKey(): { hex: string; address: string } {
  const hex = randomBytes(32).toString("hex");
  return { hex, address: privateKeyToAccount(`0x${hex}`).address };
}

describe("isValidAmount", () => {
  it("accepts positive decimals up to 1000 with at most 9 decimals", () => {
    for (const ok of ["0.3", "1", "0.000000001", "1000", "12.5"]) {
      expect(isValidAmount(ok), ok).toBe(true);
    }
    for (const bad of [
      "",
      "0",
      "0.0",
      "-1",
      "1e3",
      "01",
      ".5",
      "1.",
      "1,5",
      "1000.1",
      "0.0000000001",
      "--amount",
      "1 ",
    ]) {
      expect(isValidAmount(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("isFujiAction knows transfer and deploy", () => {
    expect(isFujiAction("transfer")).toBe(true);
    expect(isFujiAction("deploy")).toBe(true);
    expect(isFujiAction("delete")).toBe(false);
  });
});

describe("prepareFujiAction", () => {
  it("builds the transfer command from validated values", () => {
    const prepared = prepareFujiAction("transfer", { name: "myfujil1", amount: "0.3" });
    expect(prepared).toEqual({
      steps: [
        {
          cmd: "avalanche",
          args: [
            "key",
            "transfer",
            "--key",
            "myfujil1",
            "--fuji",
            "--c-chain-sender",
            "--p-chain-receiver",
            "--amount",
            "0.3",
          ],
        },
      ],
      params: { name: "myfujil1", amount: "0.3" },
    });
  });

  it("refuses a transfer with a bad name or amount", () => {
    expect(prepareFujiAction("transfer", { name: "--key", amount: "0.3" })).toEqual({
      error: "invalid transfer parameters",
    });
    expect(prepareFujiAction("transfer", { name: "myfujil1", amount: "lots" })).toEqual({
      error: "invalid transfer parameters",
    });
    expect(prepareFujiAction("transfer", { name: "myfujil1" })).toEqual({
      error: "invalid transfer parameters",
    });
  });

  it("echoes back only the values that passed validation", () => {
    const prepared = prepareFujiAction("transfer", {
      name: "myfujil1",
      amount: "0.3",
      chainId: "77777",
      token: "--force",
    });
    expect("params" in prepared && prepared.params).toEqual({
      name: "myfujil1",
      amount: "0.3",
      chainId: "77777",
    });
  });

  it("refuses a deploy with bad parameters or without the key", () => {
    expect(prepareFujiAction("deploy", { name: "myfujil1", chainId: "0", token: "FUJ" })).toEqual({
      error: "invalid deploy parameters",
    });
    expect(
      prepareFujiAction("deploy", { name: "myfujil1", chainId: "77777", token: "fuj" }),
    ).toEqual({ error: "invalid deploy parameters" });
    expect(
      prepareFujiAction("deploy", { name: "myfujil1", chainId: "77777", token: "FUJ" }),
    ).toEqual({ error: "key not found — create/fund it first" });
  });

  it("creates the L1 config owned by the key, then deploys it", () => {
    const key = throwawayKey();
    sandbox.addKey("myfujil1", key.hex);
    const prepared = prepareFujiAction("deploy", {
      name: "myfujil1",
      chainId: "77777",
      token: "FUJ",
    });
    if ("error" in prepared) throw new Error(prepared.error);
    expect(prepared.steps.map((s) => s.args.slice(0, 3))).toEqual([
      ["blockchain", "create", "myfujil1"],
      ["blockchain", "deploy", "myfujil1"],
    ]);
    const create = prepared.steps[0]?.args ?? [];
    expect(create[create.indexOf("--validator-manager-owner") + 1]).toBe(key.address);
    expect(create[create.indexOf("--proxy-contract-owner") + 1]).toBe(key.address);
    expect(create[create.indexOf("--evm-chain-id") + 1]).toBe("77777");
    expect(create[create.indexOf("--evm-token") + 1]).toBe("FUJ");
    expect(prepared.params).toEqual({ name: "myfujil1", chainId: "77777", symbol: "FUJ" });
    // The key never appears in a command.
    expect(JSON.stringify(prepared.steps)).not.toContain(key.hex);
  });

  it("skips the create step when the L1 config already exists", () => {
    sandbox.addKey("myfujil1", throwawayKey().hex);
    sandbox.addL1("myfujil1");
    const prepared = prepareFujiAction("deploy", {
      name: "myfujil1",
      chainId: "77777",
      token: "FUJ",
    });
    if ("error" in prepared) throw new Error(prepared.error);
    expect(prepared.steps.map((s) => s.args.slice(0, 2))).toEqual([["blockchain", "deploy"]]);
  });
});

describe("ensureFujiKey", () => {
  it("rejects a name that is not a valid L1 name before touching anything", async () => {
    sandbox.stub("avalanche", "() => ({})");
    await expect(ensureFujiKey("../../etc/passwd")).rejects.toBeInstanceOf(InputError);
    await expect(ensureFujiKey("--help")).rejects.toBeInstanceOf(InputError);
    expect(sandbox.calls("avalanche")).toEqual([]);
  });

  it("asks avalanche-cli to create a missing key", async () => {
    sandbox.stub("avalanche", "() => ({})");
    // The stub creates nothing, so there is still no address to report.
    expect(await ensureFujiKey("myfujil1")).toEqual({ address: null });
    expect(sandbox.calls("avalanche")).toEqual([["key", "create", "myfujil1"]]);
  });

  it("returns the address of an existing key without running the CLI", async () => {
    const key = throwawayKey();
    sandbox.addKey("myfujil1", key.hex);
    sandbox.stub("avalanche", "() => ({})");
    expect(await ensureFujiKey("myfujil1")).toEqual({ address: key.address });
    expect(sandbox.calls("avalanche")).toEqual([]);
  });
});

describe("getFujiKeyBalance", () => {
  const rpcAnswer = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("reports no address (and makes no request) when the key does not exist", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getFujiKeyBalance("myfujil1")).toEqual({
      address: null,
      cBalance: "0",
      error: null,
    });
    // An invalid name never reaches the filesystem or the network either.
    expect((await getFujiKeyBalance("../secret")).address).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("formats the C-Chain balance", async () => {
    const key = throwawayKey();
    sandbox.addKey("myfujil1", key.hex);
    // 1.5 AVAX in wei
    vi.stubGlobal("fetch", rpcAnswer({ jsonrpc: "2.0", id: 1, result: "0x14d1120d7b160000" }));
    expect(await getFujiKeyBalance("myfujil1")).toEqual({
      address: key.address,
      cBalance: "1.5000",
      error: null,
    });
  });

  it("says so when the RPC fails, instead of reporting a zero balance", async () => {
    const key = throwawayKey();
    sandbox.addKey("myfujil1", key.hex);

    vi.stubGlobal(
      "fetch",
      rpcAnswer({ jsonrpc: "2.0", id: 1, error: { message: "rate limited" } }),
    );
    expect(await getFujiKeyBalance("myfujil1")).toEqual({
      address: key.address,
      cBalance: "0",
      error: "rate limited",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect((await getFujiKeyBalance("myfujil1")).error).toBe("could not reach the Fuji RPC");
  });
});

describe("getFujiL1", () => {
  let rpc: FakeRpc;
  beforeEach(async () => {
    rpc = await startFakeRpc();
  });
  afterEach(async () => {
    await rpc.close();
  });

  it("reads a Fuji deployment from the sidecar and probes its RPC", async () => {
    sandbox.addL1("myfujil1", {
      fuji: { rpcUrl: rpc.url("myfujil1"), blockchainId: blockchainId(7).cb58 },
      evmChainId: 77777,
    });
    expect(await getFujiL1("myfujil1")).toEqual({
      deployed: true,
      rpcUrl: rpc.url("myfujil1"),
      blockchainId: blockchainId(7).cb58,
      evmChainId: 77777,
      running: true,
    });
  });

  it("reports nothing for an unknown, undeployed or invalid name", async () => {
    sandbox.addL1("localonly", {
      local: { rpcUrl: rpc.url("localonly"), blockchainId: blockchainId(8).cb58 },
    });
    const empty = {
      deployed: false,
      rpcUrl: null,
      blockchainId: null,
      evmChainId: null,
      running: false,
    };
    expect(await getFujiL1("nosuchl1")).toEqual(empty);
    expect(await getFujiL1("localonly")).toEqual(empty);
    expect(await getFujiL1("../../etc")).toEqual(empty);
  });
});
