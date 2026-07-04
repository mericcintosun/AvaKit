import type { EIP1193Provider } from "viem";
import { describe, expect, it, vi } from "vitest";
import { cChain, fuji } from "./chains.js";
import { deployContract, getBytecode } from "./deploy.js";
import { DeployFailedError, MainnetConfirmationError } from "./errors.js";

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
