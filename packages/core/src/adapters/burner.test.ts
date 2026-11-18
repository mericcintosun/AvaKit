import type { EIP1193Provider, Hex } from "viem";
import { numberToHex, parseTransaction, recoverTransactionAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AvaChain, cChain, defineChain, fuji } from "../chains.js";
import { getWalletClient } from "../clients.js";
import { ensureChain } from "../network.js";
import { endpoint, stubRpc } from "../testing/rpc.js";
import { burnerAdapter, clearBurner } from "./burner.js";

// A well-known throwaway test key (Hardhat/anvil account #0). Never real funds.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const TEST_ADDRESS = privateKeyToAccount(TEST_KEY).address;

// A second testnet, so chain-switch tests never touch mainnet (the burner is
// testnet-only and refuses mainnet — see the enforcement tests below).
const otherTestnet = defineChain({
  id: 43113001,
  name: "Other Testnet",
  rpcUrl: "https://rpc.other-testnet.example",
  explorerUrl: "https://explorer.other-testnet.example",
  nativeCurrency: { name: "Test", symbol: "TST", decimals: 18 },
  testnet: true,
});

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

    await adapter.switchChain?.(otherTestnet);
    expect(await provider.request({ method: "eth_chainId" })).toBe(numberToHex(otherTestnet.id));
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
    await adapter.switchChain?.(otherTestnet);
    expect(seen).toEqual([numberToHex(otherTestnet.id)]);
  });

  it("refuses to connect on mainnet (testnet-only key)", async () => {
    const adapter = burnerAdapter({ privateKey: TEST_KEY, persist: false, chain: cChain });
    await expect(adapter.connect()).rejects.toThrow(/testnet-only/);
  });

  it("refuses to switch to mainnet", async () => {
    const adapter = burnerAdapter({ privateKey: TEST_KEY, persist: false, chain: fuji });
    await adapter.connect();
    await expect(adapter.switchChain?.(cChain)).rejects.toThrow(/testnet-only/);
  });

  // A definition from plain JavaScript or JSON can leave `testnet` out. The
  // burner must read that as a mainnet, not as permission.
  it("refuses a chain whose definition never says testnet: true", async () => {
    const { testnet: _omitted, ...withoutFlag } = otherTestnet;
    const unflagged = withoutFlag as AvaChain;

    const created = burnerAdapter({ privateKey: TEST_KEY, persist: false, chain: unflagged });
    await expect(created.connect()).rejects.toThrow(/testnet-only/);
    await expect(created.connect()).rejects.toThrow(/no boolean `testnet` flag/);

    const adapter = burnerAdapter({ privateKey: TEST_KEY, persist: false, chain: fuji });
    const { provider } = await adapter.connect();
    await expect(adapter.switchChain?.(unflagged)).rejects.toThrow(/testnet-only/);
    await expect(ensureChain(provider, unflagged)).rejects.toThrow(/testnet-only/);
    expect(await provider.request({ method: "eth_chainId" })).toBe(numberToHex(fuji.id));
  });

  it("stays quiet when asked to switch to the chain it is already on", async () => {
    const adapter = burnerAdapter({ privateKey: TEST_KEY, persist: false, chain: fuji });
    const { provider } = await adapter.connect();
    const seen: unknown[] = [];
    (provider as EIP1193Provider).on("chainChanged", (id) => seen.push(id));

    await adapter.switchChain?.(fuji);
    await ensureChain(provider, fuji);

    expect(seen).toEqual([]);
    expect(await provider.request({ method: "eth_chainId" })).toBe(numberToHex(fuji.id));
  });

  // Templates that work across two chains do exactly this: await ensureChain()
  // for the second chain, then send on it straight away. EIP-3326's switch
  // request carries only a chain id, which the burner cannot act on, so
  // ensureChain has to reach the burner's real switch.
  describe("ensureChain", () => {
    it("moves the burner, so a transaction sent right after lands on the second chain", async () => {
      const txHash = `0x${"ab".repeat(32)}` as const;
      const secondChainRpc = endpoint(otherTestnet.rpcUrl);
      const calls = stubRpc({
        eth_chainId: (_params, url) =>
          numberToHex(url === secondChainRpc ? otherTestnet.id : fuji.id),
        eth_getTransactionCount: () => "0x0",
        eth_estimateGas: () => "0x5208",
        eth_getBlockByNumber: () => ({ number: "0x10", baseFeePerGas: "0x3b9aca00" }),
        eth_maxPriorityFeePerGas: () => "0x1",
        eth_gasPrice: () => "0x3b9aca00",
        eth_sendRawTransaction: () => txHash,
      });
      const adapter = burnerAdapter({ privateKey: TEST_KEY, persist: false, chain: fuji });
      const { address, provider } = await adapter.connect();

      await ensureChain(provider, otherTestnet);

      expect(await provider.request({ method: "eth_chainId" })).toBe(numberToHex(otherTestnet.id));
      // The wallet client checks the wallet's chain before sending, so this
      // threw a chain-mismatch error while ensureChain was a no-op for the burner.
      const wallet = getWalletClient(otherTestnet, provider);
      const sent = await wallet.sendTransaction({
        account: address,
        to: address,
        value: 0n,
      } as Parameters<typeof wallet.sendTransaction>[0]);

      expect(sent).toBe(txHash);
      const broadcast = calls.filter((call) => call.method === "eth_sendRawTransaction");
      expect(broadcast).toHaveLength(1);
      expect(broadcast[0]?.url).toBe(secondChainRpc);
      // Signed by the burner for the second chain, and nothing went to Fuji.
      const raw = broadcast[0]?.params[0] as Hex;
      expect(parseTransaction(raw).chainId).toBe(otherTestnet.id);
      expect(
        await recoverTransactionAddress({
          serializedTransaction: raw as Parameters<
            typeof recoverTransactionAddress
          >[0]["serializedTransaction"],
        }),
      ).toBe(TEST_ADDRESS);
      expect(calls.every((call) => call.url === secondChainRpc)).toBe(true);
    });

    it("tells chainChanged listeners about the switch", async () => {
      const adapter = burnerAdapter({ privateKey: TEST_KEY, persist: false, chain: fuji });
      const { provider } = await adapter.connect();
      const seen: unknown[] = [];
      (provider as EIP1193Provider).on("chainChanged", (id) => seen.push(id));

      await ensureChain(provider, otherTestnet);

      expect(seen).toEqual([numberToHex(otherTestnet.id)]);
    });

    it("refuses to move the burner to a mainnet", async () => {
      const adapter = burnerAdapter({ privateKey: TEST_KEY, persist: false, chain: fuji });
      const { provider } = await adapter.connect();
      const customMainnet = defineChain({
        id: 43113002,
        name: "Some L1 Mainnet",
        rpcUrl: "https://rpc.some-l1.example",
        explorerUrl: "https://explorer.some-l1.example",
        nativeCurrency: { name: "Some", symbol: "SOME", decimals: 18 },
        testnet: false,
      });

      await expect(ensureChain(provider, cChain)).rejects.toThrow(/testnet-only/);
      await expect(ensureChain(provider, customMainnet)).rejects.toThrow(/testnet-only/);

      // Still on the testnet it was created with.
      expect(await provider.request({ method: "eth_chainId" })).toBe(numberToHex(fuji.id));
    });
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
