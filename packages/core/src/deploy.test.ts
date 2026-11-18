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
  // What eth_getCode answers once the contract exists.
  const runtimeCode = "0x60806040";

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

  /** A chain on which the deployment was mined and its code can be read back. */
  function stubDeployed(overrides: Parameters<typeof stubRpc>[0] = {}) {
    return stubRpc({
      eth_getTransactionReceipt: () => receipt(),
      eth_getCode: () => runtimeCode,
      ...overrides,
    });
  }

  it("returns the checksummed address, the hash and an explorer link", async () => {
    stubDeployed();
    const provider = walletOn(fuji.id);

    const result = await deployContract({ artifact, chain: fuji, provider, account });

    expect(result).toEqual({
      address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      txHash,
      explorerUrl: `${fuji.explorerUrl}/address/${created}`,
    });
    // Spelled out: this is the address page on the Builder Hub explorer, a shape
    // checked to resolve there without a redirect.
    expect(result.explorerUrl).toBe(
      `https://build.avax.network/explorer/fuji/c-chain/address/${created}`,
    );
  });

  // A creation that runs out of gas (or whose constructor reverts) is still
  // mined, and the node still fills contractAddress on its receipt.
  it("rejects a reverted deployment even though the receipt names a contract address", async () => {
    const calls = stubDeployed({ eth_getTransactionReceipt: () => receipt({ status: "0x0" }) });
    const provider = walletOn(fuji.id);

    const deployment = deployContract({ artifact, chain: fuji, provider, account });

    await expect(deployment).rejects.toBeInstanceOf(DeployFailedError);
    await expect(deployment).rejects.toThrow(/reverted/);
    await expect(deployment).rejects.toThrow(txHash);
    // The receipt already settled it: there is no code to go looking for.
    expect(calls.map((call) => call.method)).toEqual(["eth_getTransactionReceipt"]);
  });

  it("rejects a mined transaction that created no contract", async () => {
    const calls = stubDeployed({
      eth_getTransactionReceipt: () => receipt({ contractAddress: null }),
    });
    const provider = walletOn(fuji.id);

    await expect(
      deployContract({ artifact, chain: fuji, provider, account }),
    ).rejects.toBeInstanceOf(DeployFailedError);
    expect(calls.map((call) => call.method)).toEqual(["eth_getTransactionReceipt"]);
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
    const calls = stubDeployed();

    const result = await deployContract({
      artifact,
      chain: freshL1,
      provider: walletOn(freshL1.id),
      account,
    });

    expect(result.explorerUrl).toBe("");
    expect(result.address).toBe("0x5FbDB2315678afecb367f032d93F642f64180aa3");
    // The receipt and the code were read from the L1's own RPC.
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
        eth_getCode: () => runtimeCode,
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
    const calls = stubDeployed();

    await deployContract({ artifact, chain: fuji, provider: walletOn(fuji.id), account });

    expect(calls.map((call) => call.method)).toEqual(["eth_getTransactionReceipt", "eth_getCode"]);
  });

  // A successful receipt is half of "deployed". The other half is code at the
  // address: a creation that returns no runtime code succeeds and leaves an
  // empty account, which every later call would silently "work" against.
  describe("code at the new address", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** What eth_getCode answers, read by read; the last answer repeats. "0x" is an empty account. */
    function codeReads(...answers: Array<string | Error>) {
      let read = 0;
      return () => {
        const answer = answers[Math.min(read, answers.length - 1)];
        read += 1;
        if (answer instanceof Error) {
          throw { code: -32000, message: answer.message };
        }
        return answer;
      };
    }

    function getCodeCalls(calls: ReturnType<typeof stubRpc>) {
      return calls.filter((call) => call.method === "eth_getCode");
    }

    /** Start a deployment on Fuji and capture how it ends, without an unhandled rejection. */
    function deployOn(chain: AvaChain, confirmMainnet?: boolean) {
      return deployContract({
        artifact,
        chain,
        provider: walletOn(chain.id),
        account,
        confirmMainnet,
      }).then(
        (result) => ({ result, error: null }),
        (error: unknown) => ({ result: null, error: error as Error }),
      );
    }

    it("reads the code at the created address before resolving", async () => {
      const calls = stubDeployed();

      const { result } = await deployOn(fuji);

      expect(result?.address).toBe("0x5FbDB2315678afecb367f032d93F642f64180aa3");
      const reads = getCodeCalls(calls);
      expect(reads).toHaveLength(1);
      expect(String(reads[0]?.params[0]).toLowerCase()).toBe(created);
      expect(reads[0]?.url).toBe(endpoint(fuji.rpcUrl));
    });

    it("rejects a successful receipt that left no code behind", async () => {
      vi.useFakeTimers();
      const calls = stubDeployed({ eth_getCode: () => "0x" });

      const outcome = deployOn(fuji);
      await vi.advanceTimersByTimeAsync(2000);
      const { result, error } = await outcome;

      expect(result).toBeNull();
      expect(error).toBeInstanceOf(DeployFailedError);
      expect(error?.message).toMatch(
        /no contract code at 0x5FbDB2315678afecb367f032d93F642f64180aa3/,
      );
      expect(error?.message).toContain(`${fuji.explorerUrl}/tx/${txHash}`);
      // One read at once and four more over the two seconds: bounded, not a poll.
      expect(getCodeCalls(calls)).toHaveLength(5);
    });

    it("gives up after two seconds, not before, and leaves nothing running", async () => {
      vi.useFakeTimers();
      const calls = stubDeployed({ eth_getCode: () => "0x" });
      let settled = false;

      const outcome = deployOn(fuji).then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(1999);
      expect(settled).toBe(false);
      expect(getCodeCalls(calls)).toHaveLength(4);

      await vi.advanceTimersByTimeAsync(1);
      await outcome;
      expect(settled).toBe(true);
      expect(getCodeCalls(calls)).toHaveLength(5);
      expect(vi.getTimerCount()).toBe(0);
    });

    // A block can be accepted, and its receipt served, before the state behind
    // it can be read. One empty read must not fail a deployment that worked.
    it("accepts a deployment whose code shows up on a later read", async () => {
      vi.useFakeTimers();
      const calls = stubDeployed({ eth_getCode: codeReads("0x", "0x", runtimeCode) });

      const outcome = deployOn(fuji);
      await vi.advanceTimersByTimeAsync(2000);
      const { result, error } = await outcome;

      expect(error).toBeNull();
      expect(result).toMatchObject({
        address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        txHash,
      });
      expect(getCodeCalls(calls)).toHaveLength(3);
    });

    it("retries a read that failed, and accepts the deployment once it answers", async () => {
      vi.useFakeTimers();
      const calls = stubDeployed({
        eth_getCode: codeReads(new Error("header not found"), runtimeCode),
      });

      const outcome = deployOn(fuji);
      await vi.advanceTimersByTimeAsync(2000);
      const { result, error } = await outcome;

      expect(error).toBeNull();
      expect(result?.txHash).toBe(txHash);
      expect(getCodeCalls(calls)).toHaveLength(2);
    });

    it("rejects, naming the address and the cause, when the code cannot be read at all", async () => {
      vi.useFakeTimers();
      const calls = stubDeployed({ eth_getCode: codeReads(new Error("header not found")) });

      const outcome = deployOn(fuji);
      await vi.advanceTimersByTimeAsync(2000);
      const { error } = await outcome;

      expect(error).toBeInstanceOf(DeployFailedError);
      expect(error?.message).toMatch(/could not be read back/);
      expect(error?.message).toContain("0x5FbDB2315678afecb367f032d93F642f64180aa3");
      expect(error?.message).toContain(txHash);
      expect(error?.cause).toBeDefined();
      expect(getCodeCalls(calls)).toHaveLength(5);
    });

    it("applies on a mainnet too", async () => {
      vi.useFakeTimers();
      stubDeployed({
        eth_getBalance: () => "0xde0b6b3a7640000",
        eth_estimateGas: () => "0x5208",
        eth_gasPrice: () => "0x1",
        eth_getCode: () => "0x",
      });

      const outcome = deployOn(cChain, true);
      await vi.advanceTimersByTimeAsync(2000);
      const { error } = await outcome;

      expect(error).toBeInstanceOf(DeployFailedError);
      expect(error?.message).toMatch(/no contract code/);
    });

    it("names no explorer in the error on a chain without one", async () => {
      vi.useFakeTimers();
      const freshL1 = defineChain({
        id: 1001,
        name: "Fresh L1",
        rpcUrl: "http://127.0.0.1:9650/ext/bc/fresh/rpc",
        explorerUrl: "",
        nativeCurrency: { name: "Fresh", symbol: "FRSH", decimals: 18 },
        testnet: true,
      });
      stubDeployed({ eth_getCode: () => "0x" });

      const outcome = deployOn(freshL1);
      await vi.advanceTimersByTimeAsync(2000);
      const { error } = await outcome;

      expect(error).toBeInstanceOf(DeployFailedError);
      expect(error?.message).toMatch(/no contract code/);
      expect(error?.message).not.toMatch(/https?:\/\//);
      expect(error?.message).not.toContain("()");
    });
  });
});
