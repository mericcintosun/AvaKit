import { cChain, fuji } from "@avakit/core";
import { generatePrivateKey } from "viem/accounts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deployOutcome } from "./deploy.js";
import { type Connection, connect } from "./testing/connect.js";

const TX_HASH = `0x${"ab".repeat(32)}` as const;
const CONTRACT = "0x00000000000000000000000000000000000000C1" as const;

// What the fake chain answers. No RPC is contacted and nothing is broadcast:
// the two things that would do so — the wallet client and the public client —
// are replaced below, and everything else in viem and @avakit/core is real.
const chain = vi.hoisted(() => ({
  balance: 0n,
  receipt: {} as { status: "success" | "reverted"; contractAddress?: string | null },
  sent: [] as unknown[],
}));

vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createWalletClient: () => ({
    deployContract: async (request: unknown) => {
      chain.sent.push(request);
      return `0x${"ab".repeat(32)}`;
    },
  }),
}));

vi.mock("@avakit/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@avakit/core")>()),
  getBalance: async () => chain.balance,
  getPublicClient: () => ({ waitForTransactionReceipt: async () => chain.receipt }),
}));

describe("deployOutcome", () => {
  it("returns the address and explorer link when the creation succeeded", () => {
    expect(deployOutcome({ status: "success", contractAddress: CONTRACT }, TX_HASH, fuji)).toEqual({
      ok: true,
      result: {
        address: CONTRACT,
        txHash: TX_HASH,
        explorerUrl: `${fuji.explorerUrl}/address/${CONTRACT}`,
      },
    });
  });

  it("is a failure when the transaction reverted, even though the receipt has an address", () => {
    // A node derives contractAddress from the sender and nonce for every
    // creation transaction, so a reverted one carries it too — with no code there.
    const outcome = deployOutcome({ status: "reverted", contractAddress: CONTRACT }, TX_HASH, fuji);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("reverted");
    expect(outcome.message).toContain(TX_HASH);
    expect(outcome.message).toContain(`${fuji.explorerUrl}/tx/${TX_HASH}`);
    expect(outcome.message).not.toContain(CONTRACT);
  });

  it("is a failure when the receipt has no contract address", () => {
    for (const contractAddress of [null, undefined]) {
      const outcome = deployOutcome({ status: "success", contractAddress }, TX_HASH, cChain);
      expect(outcome).toEqual({ ok: false, message: expect.stringContaining("contract address") });
    }
  });
});

describe("deploy_contract", () => {
  let mcp: Connection;
  beforeAll(async () => {
    mcp = await connect();
  });
  afterAll(() => mcp.close());

  beforeEach(() => {
    chain.balance = 10n ** 18n;
    chain.receipt = { status: "success", contractAddress: CONTRACT };
    chain.sent = [];
    // A fresh random key per test: never a literal, never written anywhere.
    vi.stubEnv("AVAKIT_DEPLOYER_KEY", generatePrivateKey());
    vi.stubEnv("AVAKIT_ALLOW_MAINNET", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  const deploy = (args: Record<string, unknown> = {}) =>
    mcp.call("deploy_contract", { abi: [], bytecode: "0x6080", ...args });

  it("returns the deployed address for a successful creation", async () => {
    const result = await deploy();
    expect(result.isError).toBe(false);
    expect(result.json()).toEqual({
      address: CONTRACT,
      txHash: TX_HASH,
      explorerUrl: `${fuji.explorerUrl}/address/${CONTRACT}`,
    });
    expect(chain.sent).toHaveLength(1);
  });

  it("reports a reverted creation as an error instead of a deployed contract", async () => {
    chain.receipt = { status: "reverted", contractAddress: CONTRACT };
    const result = await deploy();
    // This returned { address, txHash, explorerUrl } with isError false: an
    // agent was told a contract existed at an address that holds no code.
    expect(result.isError).toBe(true);
    expect(result.text).toContain("reverted");
    expect(result.text).toContain(TX_HASH);
    expect(result.text).not.toContain(CONTRACT);
  });

  it("reports a receipt without a contract address as an error", async () => {
    chain.receipt = { status: "success", contractAddress: null };
    const result = await deploy();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("contract address");
  });

  it("refuses, before sending anything, when the deployer has no funds", async () => {
    chain.balance = 0n;
    const result = await deploy();
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/has no AVAX on Avalanche Fuji/);
    expect(chain.sent).toEqual([]);
  });

  it("refuses when no deployer key is configured", async () => {
    vi.stubEnv("AVAKIT_DEPLOYER_KEY", "");
    const result = await deploy();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("AVAKIT_DEPLOYER_KEY");
    expect(chain.sent).toEqual([]);
  });

  it("refuses mainnet unless both the caller and the server environment allow it", async () => {
    const unconfirmed = await deploy({ chain: "c-chain" });
    expect(unconfirmed.isError).toBe(true);
    expect(unconfirmed.text).toContain("without confirm:true");

    // confirm:true is something a prompt can talk an agent into; the env is not.
    const confirmedOnly = await deploy({ chain: "c-chain", confirm: true });
    expect(confirmedOnly.isError).toBe(true);
    expect(confirmedOnly.text).toContain("AVAKIT_ALLOW_MAINNET=1");
    expect(chain.sent).toEqual([]);

    vi.stubEnv("AVAKIT_ALLOW_MAINNET", "1");
    const allowed = await deploy({ chain: "c-chain", confirm: true });
    expect(allowed.isError).toBe(false);
    expect(allowed.json()).toMatchObject({
      explorerUrl: `${cChain.explorerUrl}/address/${CONTRACT}`,
    });
    expect(chain.sent).toHaveLength(1);
  });

  it("rejects bytecode that is not hex", async () => {
    const result = await deploy({ bytecode: "0xnothex" });
    expect(result.isError).toBe(true);
    expect(chain.sent).toEqual([]);
  });
});
