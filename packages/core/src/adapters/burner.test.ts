import type { EIP1193Provider } from "viem";
import { numberToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cChain, fuji } from "../chains.js";
import { burnerAdapter, clearBurner } from "./burner.js";

// A well-known throwaway test key (Hardhat/anvil account #0). Never real funds.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const TEST_ADDRESS = privateKeyToAccount(TEST_KEY).address;

/** In-memory localStorage mock for the persistence tests. */
function mockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    _store: store,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("burnerAdapter", () => {
  it("is always available (no keys or extension needed)", () => {
    expect(burnerAdapter({ persist: false }).isAvailable()).toBe(true);
  });

  it("connects with a supplied key and exposes that account", async () => {
    const adapter = burnerAdapter({ privateKey: TEST_KEY, persist: false });
    const { address, provider } = await adapter.connect();
    expect(address).toBe(TEST_ADDRESS);
    const accounts = await provider.request({ method: "eth_accounts" });
    expect(accounts).toEqual([TEST_ADDRESS]);
    expect(adapter.getProvider()).toBe(provider);
  });

  it("reports the initial chain id and follows switchChain", async () => {
    const adapter = burnerAdapter({ privateKey: TEST_KEY, persist: false, chain: fuji });
    const { provider } = await adapter.connect();
    expect(await provider.request({ method: "eth_chainId" })).toBe(numberToHex(fuji.id));

    await adapter.switchChain?.(cChain);
    expect(await provider.request({ method: "eth_chainId" })).toBe(numberToHex(cChain.id));
  });

  it("signs messages locally with the burner key", async () => {
    const adapter = burnerAdapter({ privateKey: TEST_KEY, persist: false });
    const { provider } = await adapter.connect();
    const sig = (await provider.request({
      method: "personal_sign",
      params: ["0xdeadbeef", TEST_ADDRESS],
    })) as string;
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("emits chainChanged to EIP-1193 listeners on switch", async () => {
    const adapter = burnerAdapter({ privateKey: TEST_KEY, persist: false });
    const { provider } = await adapter.connect();
    const seen: unknown[] = [];
    (provider as EIP1193Provider).on("chainChanged", (id) => seen.push(id));
    await adapter.switchChain?.(cChain);
    expect(seen).toEqual([numberToHex(cChain.id)]);
  });

  it("persists the key so reconnecting restores the same address", async () => {
    vi.stubGlobal("localStorage", mockStorage());
    const first = await burnerAdapter({}).connect();
    const second = await burnerAdapter({}).connect();
    expect(second.address).toBe(first.address);
  });

  it("clearBurner forgets the persisted key", async () => {
    const ls = mockStorage();
    vi.stubGlobal("localStorage", ls);
    await burnerAdapter({ storageKey: "avakit.burner.pk" }).connect();
    expect(ls._store.size).toBe(1);
    clearBurner("avakit.burner.pk");
    expect(ls._store.size).toBe(0);
  });

  it("does not persist when persist is false", async () => {
    const ls = mockStorage();
    vi.stubGlobal("localStorage", ls);
    await burnerAdapter({ persist: false }).connect();
    expect(ls._store.size).toBe(0);
  });
});
