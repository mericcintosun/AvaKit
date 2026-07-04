import type { EIP1193Provider } from "viem";
import { describe, expect, it, vi } from "vitest";
import { fuji } from "./chains.js";
import { ensureChain } from "./network.js";

type Handler = (args: { method: string; params?: unknown }) => Promise<unknown>;

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

  it("rethrows errors that are not 4902 (e.g. user rejection)", async () => {
    const provider = providerWith(async () => {
      throw { code: 4001 };
    });
    await expect(ensureChain(provider, fuji)).rejects.toMatchObject({ code: 4001 });
    // Should not attempt to add the chain for a non-4902 failure.
    expect(methodsCalled(provider)).toEqual(["wallet_switchEthereumChain"]);
  });
});
