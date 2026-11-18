import type { EIP1193Provider } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AvaChain, cChain, defineChain, fuji } from "./chains.js";
import { deployContract, getBytecode } from "./deploy.js";
import { DeployFailedError, InsufficientFundsError, MainnetConfirmationError } from "./errors.js";
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
    // which rejects here for an unrelated reason — never the mainnet guard. The
    // account is funded, so the balance check lets the deployment through.
    stubRpc({
      eth_getBalance: () => "0xde0b6b3a7640000",
      eth_estimateGas: () => "0x5208",
      eth_gasPrice: () => "0x1",
    });
    const rejectingProvider = {
      request: vi.fn(async () => {
        throw new Error("no rpc in test");
      }),
    } as unknown as EIP1193Provider;
    const deployment = deployContract({
      artifact,
      chain: cChain,
      provider: rejectingProvider,
      account,
      confirmMainnet: true,
    });
    await expect(deployment).rejects.not.toBeInstanceOf(MainnetConfirmationError);
    await expect(deployment).rejects.toThrow("no rpc in test");
    expect(rejectingProvider.request).toHaveBeenCalled();
  });

  // The type requires `testnet`, but a plain-JavaScript or JSON definition can
  // leave it out. That must not read as "testnet" and skip the confirmation.
  it("refuses a chain whose definition has no testnet flag, and says why", async () => {
    const { testnet: _omitted, ...withoutFlag } = fuji;
    const unflagged = { ...withoutFlag, id: 99_999, name: "Unflagged L1" } as AvaChain;

    const deployment = deployContract({ artifact, chain: unflagged, provider, account });

    await expect(deployment).rejects.toBeInstanceOf(MainnetConfirmationError);
    await expect(deployment).rejects.toThrow(/no boolean `testnet` flag/);
    expect(provider.request).not.toHaveBeenCalled();
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

  // Mainnet deploys need two things: the explicit confirmation, and a balance
  // check before anything is sent.
  describe("on a mainnet, with confirmMainnet", () => {
    const gas = 100_000n;
    const gasPrice = 25_000_000_000n; // 25 nAVAX
    const cost = gas * gasPrice; // 0.0025 AVAX

    /** The chain as the balance check sees it: this balance, this gas, this price. */
    function stubMainnet(balance: bigint, overrides: Parameters<typeof stubRpc>[0] = {}) {
      return stubRpc({
        eth_getBalance: () => `0x${balance.toString(16)}`,
        eth_estimateGas: () => `0x${gas.toString(16)}`,
        eth_gasPrice: () => `0x${gasPrice.toString(16)}`,
        eth_getTransactionReceipt: () => receipt(),
        ...overrides,
      });
    }

    it("refuses a deployment the account cannot pay for, before the wallet is asked", async () => {
      const calls = stubMainnet(cost - 1n);
      const provider = walletOn(cChain.id);

      const deployment = deployContract({
        artifact,
        chain: cChain,
        provider,
        account,
        confirmMainnet: true,
      });

      await expect(deployment).rejects.toBeInstanceOf(InsufficientFundsError);
      await expect(deployment).rejects.toThrow(/estimated to cost 0\.0025 AVAX/);
      await expect(deployment).rejects.toThrow(cChain.name);
      // Nothing was signed or sent.
      expect(provider.request).not.toHaveBeenCalled();
      expect(calls.map((call) => call.method).sort()).toEqual([
        "eth_estimateGas",
        "eth_gasPrice",
        "eth_getBalance",
      ]);
    });

    it("refuses an empty account", async () => {
      stubMainnet(0n);
      const provider = walletOn(cChain.id);

      const deployment = deployContract({
        artifact,
        chain: cChain,
        provider,
        account,
        confirmMainnet: true,
      });

      await expect(deployment).rejects.toThrow(/holds 0 AVAX/);
      expect(provider.request).not.toHaveBeenCalled();
    });

    it("deploys once the balance covers the estimated cost", async () => {
      const calls = stubMainnet(cost);
      const provider = walletOn(cChain.id);

      const result = await deployContract({
        artifact,
        chain: cChain,
        provider,
        account,
        confirmMainnet: true,
      });

      expect(result.address).toBe("0x5FbDB2315678afecb367f032d93F642f64180aa3");
      expect(result.explorerUrl).toBe(`${cChain.explorerUrl}/address/${created}`);
      // The estimate was made for this account deploying this bytecode.
      const estimate = calls.find((call) => call.method === "eth_estimateGas");
      expect(estimate?.params[0]).toMatchObject({ from: account, data: "0x6080" });
      expect(calls.every((call) => call.url === endpoint(cChain.rpcUrl))).toBe(true);
    });

    it("refuses when the cost cannot be worked out, and sends nothing", async () => {
      stubMainnet(cost, {
        eth_estimateGas: () => {
          throw { code: 3, message: "execution reverted: constructor rejected" };
        },
      });
      const provider = walletOn(cChain.id);

      const deployment = deployContract({
        artifact,
        chain: cChain,
        provider,
        account,
        confirmMainnet: true,
      });

      await expect(deployment).rejects.toBeInstanceOf(DeployFailedError);
      await expect(deployment).rejects.toThrow(/nothing was sent/);
      expect(provider.request).not.toHaveBeenCalled();
    });

    it("applies to a chain that never said testnet: true", async () => {
      const { testnet: _omitted, ...withoutFlag } = fuji;
      const unflagged = { ...withoutFlag, id: 99_999, name: "Unflagged L1" } as AvaChain;
      stubMainnet(0n);
      const provider = walletOn(unflagged.id);

      await expect(
        deployContract({ artifact, chain: unflagged, provider, account, confirmMainnet: true }),
      ).rejects.toBeInstanceOf(InsufficientFundsError);
      expect(provider.request).not.toHaveBeenCalled();
    });
  });

  it("does not check the balance on a testnet", async () => {
    const calls = stubRpc({ eth_getTransactionReceipt: () => receipt() });

    await deployContract({ artifact, chain: fuji, provider: walletOn(fuji.id), account });

    expect(calls.map((call) => call.method)).toEqual(["eth_getTransactionReceipt"]);
  });
});
