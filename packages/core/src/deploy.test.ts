import type { EIP1193Provider } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cChain, defineChain, fuji } from "./chains.js";
import { deployContract, getBytecode } from "./deploy.js";
import { DeployFailedError, MainnetConfirmationError } from "./errors.js";
import { endpoint, stubRpc } from "./testing/rpc.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getBytecode", () => {
  it("reads the Foundry object shape", () => {
    expect(getBytecode({ abi: [], bytecode: { object: "0x6080" } })).toBe("0x6080");
  });

  it("reads the flat hex shape", () => {
    expect(getBytecode({ abi: [], bytecode: "0xdead" })).toBe("0xdead");
  });

  it("throws when bytecode is missing or unprefixed", () => {
    expect(() => getBytecode({ abi: [], bytecode: "6080" as `0x${string}` })).toThrow(
      DeployFailedError,
    );
  });
});

describe("deployContract mainnet guard", () => {
  const artifact = { abi: [], bytecode: "0x6080" as const };
  const account = "0x0000000000000000000000000000000000000001" as const;
  // The guard runs before any client/provider work, so this is never called.
  const provider = { request: vi.fn() } as unknown as EIP1193Provider;

  it("refuses a non-testnet chain without confirmMainnet", async () => {
    await expect(
      deployContract({ artifact, chain: cChain, provider, account }),
    ).rejects.toBeInstanceOf(MainnetConfirmationError);
    expect(provider.request).not.toHaveBeenCalled();
  });

  it("allows a non-testnet chain when confirmMainnet is passed (guard skipped)", async () => {
    // With confirmMainnet the guard is skipped, so it proceeds to the provider,
    // which rejects here for an unrelated reason — never the mainnet guard.
    const rejectingProvider = {
      request: vi.fn(async () => {
        throw new Error("no rpc in test");
      }),
    } as unknown as EIP1193Provider;
    await expect(
      deployContract({
        artifact,
        chain: cChain,
        provider: rejectingProvider,
        account,
        confirmMainnet: true,
      }),
    ).rejects.not.toBeInstanceOf(MainnetConfirmationError);
  });

  it("does not apply the guard to testnet chains (Fuji)", async () => {
    const rejectingProvider = {
      request: vi.fn(async () => {
        throw new Error("no rpc in test");
      }),
    } as unknown as EIP1193Provider;
    await expect(
      deployContract({ artifact, chain: fuji, provider: rejectingProvider, account }),
    ).rejects.not.toBeInstanceOf(MainnetConfirmationError);
  });
});

describe("deployContract result", () => {
  const artifact = { abi: [], bytecode: "0x6080" as const };
  const account = "0x0000000000000000000000000000000000000001" as const;
  const txHash = `0x${"ab".repeat(32)}` as const;
  // Lower-case, as a node returns it; the result must come back checksummed.
  const created = "0x5fbdb2315678afecb367f032d93f642f64180aa3";

  /** A wallet on `chainId` that accepts the deployment and returns its hash. */
  function walletOn(chainId: number): EIP1193Provider {
    return {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
        if (method === "eth_sendTransaction") return txHash;
        throw new Error(`unexpected wallet request: ${method}`);
      }),
    } as unknown as EIP1193Provider;
  }

  /** The receipt a node returns for the deployment, in raw JSON-RPC form. */
  function receipt(overrides: Record<string, unknown> = {}) {
    return {
      transactionHash: txHash,
      transactionIndex: "0x0",
      blockHash: `0x${"cd".repeat(32)}`,
      blockNumber: "0x10",
      from: account,
      to: null,
      cumulativeGasUsed: "0x5208",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x1",
      contractAddress: created,
      logs: [],
      logsBloom: `0x${"00".repeat(256)}`,
      status: "0x1",
      type: "0x2",
      ...overrides,
    };
  }

  it("returns the checksummed address, the hash and an explorer link", async () => {
    stubRpc({ eth_getTransactionReceipt: () => receipt() });
    const provider = walletOn(fuji.id);

    const result = await deployContract({ artifact, chain: fuji, provider, account });

    expect(result).toEqual({
      address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      txHash,
      explorerUrl: `${fuji.explorerUrl}/address/${created}`,
    });
  });

  // A creation that runs out of gas (or whose constructor reverts) is still
  // mined, and the node still fills contractAddress on its receipt.
  it("rejects a reverted deployment even though the receipt names a contract address", async () => {
    stubRpc({ eth_getTransactionReceipt: () => receipt({ status: "0x0" }) });
    const provider = walletOn(fuji.id);

    const deployment = deployContract({ artifact, chain: fuji, provider, account });

    await expect(deployment).rejects.toBeInstanceOf(DeployFailedError);
    await expect(deployment).rejects.toThrow(/reverted/);
    await expect(deployment).rejects.toThrow(txHash);
  });

  it("rejects a mined transaction that created no contract", async () => {
    stubRpc({ eth_getTransactionReceipt: () => receipt({ contractAddress: null }) });
    const provider = walletOn(fuji.id);

    await expect(
      deployContract({ artifact, chain: fuji, provider, account }),
    ).rejects.toBeInstanceOf(DeployFailedError);
  });

  it("returns an empty explorer link on a chain without an explorer", async () => {
    const freshL1 = defineChain({
      id: 1001,
      name: "Fresh L1",
      rpcUrl: "http://127.0.0.1:9650/ext/bc/fresh/rpc",
      explorerUrl: "",
      nativeCurrency: { name: "Fresh", symbol: "FRSH", decimals: 18 },
      testnet: true,
    });
    const calls = stubRpc({ eth_getTransactionReceipt: () => receipt() });

    const result = await deployContract({
      artifact,
      chain: freshL1,
      provider: walletOn(freshL1.id),
      account,
    });

    expect(result.explorerUrl).toBe("");
    expect(result.address).toBe("0x5FbDB2315678afecb367f032d93F642f64180aa3");
    // The receipt was read from the L1's own RPC.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.url === endpoint(freshL1.rpcUrl))).toBe(true);
  });
});
