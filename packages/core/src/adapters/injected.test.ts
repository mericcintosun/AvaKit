import type { EIP1193Provider } from "viem";
import { describe, expect, it, vi } from "vitest";
import { WalletNotAvailableError } from "../errors.js";
import { injectedAdapter } from "./injected.js";

function mockProvider(accounts: string[]): EIP1193Provider {
  return {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts") return accounts;
      return null;
    }),
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as EIP1193Provider;
}

describe("injectedAdapter", () => {
  it("reports availability based on the provider", () => {
    expect(injectedAdapter({ provider: mockProvider(["0x1"]) }).isAvailable()).toBe(true);
    expect(injectedAdapter({}).isAvailable()).toBe(false);
  });

  it("connects and returns the first account", async () => {
    const provider = mockProvider(["0x000000000000000000000000000000000000dEaD"]);
    const adapter = injectedAdapter({ provider });
    const { address, provider: p } = await adapter.connect();
    expect(address).toBe("0x000000000000000000000000000000000000dEaD");
    expect(p).toBe(provider);
    expect(adapter.getProvider()).toBe(provider);
  });

  it("throws a typed error when no provider is available", async () => {
    await expect(injectedAdapter({}).connect()).rejects.toBeInstanceOf(WalletNotAvailableError);
  });
});
