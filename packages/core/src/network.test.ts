import type { EIP1193Provider } from "viem";
import { describe, expect, it, vi } from "vitest";
import { defineChain, fuji } from "./chains.js";
import { ensureChain } from "./network.js";

type Handler = (args: { method: string; params?: unknown }) => Promise<unknown>;

/** A freshly launched L1, defined the way the devnet templates do (no explorer). */
const freshL1 = defineChain({
  id: 1001,
  name: "Fresh L1",
  rpcUrl: "http://127.0.0.1:9650/ext/bc/fresh/rpc",
  explorerUrl: "",
  nativeCurrency: { name: "Fresh", symbol: "FRSH", decimals: 18 },
  testnet: true,
});

/** A provider that does not know the chain yet: the first switch reports 4902. */
function providerMissingChain(): EIP1193Provider {
  let firstSwitchDone = false;
  return providerWith(async ({ method }) => {
    if (method === "wallet_switchEthereumChain" && !firstSwitchDone) {
      firstSwitchDone = true;
      throw { code: 4902 };
    }
    return null;
  });
}

/** The single parameter object of the wallet_addEthereumChain request that was sent. */
function addChainParams(provider: EIP1193Provider): Record<string, unknown> {
  const calls = (
    provider.request as unknown as {
      mock: { calls: [{ method: string; params?: [Record<string, unknown>] }][] };
    }
  ).mock.calls;
  const add = calls.find((call) => call[0].method === "wallet_addEthereumChain");
  if (!add?.[0].params) throw new Error("wallet_addEthereumChain was not requested");
  return add[0].params[0];
}

function providerWith(handler: Handler): EIP1193Provider {
  return {
    request: vi.fn(handler),
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as EIP1193Provider;
}

function methodsCalled(provider: EIP1193Provider): string[] {
  return (
    provider.request as unknown as { mock: { calls: [{ method: string }][] } }
  ).mock.calls.map((call) => call[0].method);
}

describe("ensureChain", () => {
  it("switches without adding when the wallet already knows the chain", async () => {
    const provider = providerWith(async () => null);
    await ensureChain(provider, fuji);
    expect(methodsCalled(provider)).toEqual(["wallet_switchEthereumChain"]);
  });

  it("adds then switches when the wallet reports 4902 (unknown chain)", async () => {
    let firstSwitchDone = false;
    const provider = providerWith(async ({ method }) => {
      if (method === "wallet_switchEthereumChain" && !firstSwitchDone) {
        firstSwitchDone = true;
        throw { code: 4902 };
      }
      return null;
    });
    await ensureChain(provider, fuji);
    expect(methodsCalled(provider)).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ]);
  });

  it("describes the chain to the wallet, explorer included, when it has one", async () => {
    const provider = providerMissingChain();
    await ensureChain(provider, fuji);
    expect(addChainParams(provider)).toEqual({
      chainId: "0xa869",
      chainName: fuji.name,
      nativeCurrency: fuji.nativeCurrency,
      rpcUrls: [fuji.rpcUrl],
      blockExplorerUrls: [fuji.explorerUrl],
    });
  });

  // MetaMask rejects wallet_addEthereumChain when blockExplorerUrls holds an
  // empty string, which is what a chain with no explorer used to produce.
  it("leaves blockExplorerUrls out when the chain has no explorer", async () => {
    const provider = providerMissingChain();
    await ensureChain(provider, freshL1);
    const params = addChainParams(provider);
    expect(params).not.toHaveProperty("blockExplorerUrls");
    expect(params).toEqual({
      chainId: "0x3e9",
      chainName: freshL1.name,
      nativeCurrency: freshL1.nativeCurrency,
      rpcUrls: [freshL1.rpcUrl],
    });
    // The chain is still switched to after being added.
    expect(methodsCalled(provider)).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ]);
  });

  it("rethrows errors that are not 4902 (e.g. user rejection)", async () => {
    const provider = providerWith(async () => {
      throw { code: 4001 };
    });
    await expect(ensureChain(provider, fuji)).rejects.toMatchObject({ code: 4001 });
    // Should not attempt to add the chain for a non-4902 failure.
    expect(methodsCalled(provider)).toEqual(["wallet_switchEthereumChain"]);
  });
});
