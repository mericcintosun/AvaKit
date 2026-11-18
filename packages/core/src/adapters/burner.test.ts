import type { EIP1193Provider, Hex } from "viem";
import {
  numberToHex,
  parseTransaction,
  recoverTransactionAddress,
  verifyMessage,
  verifyTypedData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AvaChain, cChain, defineChain, fuji } from "../chains.js";
import { getWalletClient } from "../clients.js";
import { WalletConnectionError } from "../errors.js";
import { ensureChain } from "../network.js";
import { endpoint, type RpcCall, type RpcHandlers, stubRpc } from "../testing/rpc.js";
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

  // The route an app takes through viem: the wallet client serialises the
  // request and asks the wallet for personal_sign / eth_signTypedData_v4.
  it("signs messages and EIP-712 typed data that verify against the burner address", async () => {
    const adapter = burnerAdapter({ privateKey: TEST_KEY, persist: false });
    const { address, provider } = await adapter.connect();
    const wallet = getWalletClient(fuji, provider);
    const typedData = {
      domain: { name: "AvaKit", version: "1", chainId: fuji.id },
      types: {
        Greeting: [
          { name: "text", type: "string" },
          { name: "nonce", type: "uint256" },
        ],
      },
      primaryType: "Greeting",
      message: { text: "gm", nonce: 7n },
    } as const;

    const messageSignature = await wallet.signMessage({ account: address, message: "gm" });
    const typedSignature = await wallet.signTypedData({ account: address, ...typedData });

    expect(await verifyMessage({ address, message: "gm", signature: messageSignature })).toBe(true);
    expect(await verifyTypedData({ address, ...typedData, signature: typedSignature })).toBe(true);
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

  // The id and the testnet flag are what a definition says about itself; the
  // RPC URL decides where a transaction really goes. A definition labelled Fuji
  // that points at a mainnet node must not get the burner to transact there.
  describe("signs transactions only for the chain its definition names", () => {
    const txHash = `0x${"ab".repeat(32)}` as const;

    /** What a plain transfer asks of a node, with `eth_chainId` answered as given. */
    function node(chainId: (url: string) => unknown, overrides: RpcHandlers = {}): RpcHandlers {
      return {
        eth_chainId: (_params, url) => chainId(url),
        eth_getTransactionCount: () => "0x0",
        eth_estimateGas: () => "0x5208",
        eth_getBlockByNumber: () => ({ number: "0x10", baseFeePerGas: "0x3b9aca00" }),
        eth_maxPriorityFeePerGas: () => "0x1",
        eth_gasPrice: () => "0x3b9aca00",
        eth_sendRawTransaction: () => txHash,
        ...overrides,
      };
    }

    async function connectOn(chain: AvaChain) {
      const adapter = burnerAdapter({ privateKey: TEST_KEY, persist: false, chain });
      const { provider } = await adapter.connect();
      const send = () =>
        provider.request({
          method: "eth_sendTransaction",
          params: [{ from: TEST_ADDRESS, to: TEST_ADDRESS, value: "0x0" }],
        });
      return { adapter, provider, send };
    }

    const methods = (calls: RpcCall[]) => calls.map((call) => call.method);
    const count = (calls: RpcCall[], method: string) =>
      calls.filter((call) => call.method === method).length;

    it("refuses when the node behind a Fuji-labelled definition is the C-Chain mainnet", async () => {
      const calls = stubRpc(node(() => numberToHex(cChain.id)));
      const { provider, send } = await connectOn(fuji);

      const sent = send();

      await expect(sent).rejects.toBeInstanceOf(WalletConnectionError);
      await expect(sent).rejects.toThrow(
        "Nothing was signed or sent: Avalanche Fuji is defined as chain 43113, but the node at " +
          "its rpcUrl reports chain 43114, which is a mainnet. The temporary (burner) wallet is " +
          "testnet-only. Point the definition's rpcUrl at a chain 43113 node, or connect a real " +
          "wallet (injected / social) to use mainnet.",
      );
      // The node was asked which chain it is, and for nothing else.
      expect(methods(calls)).toEqual(["eth_chainId"]);
      // The wallet still says where its definition puts it.
      expect(await provider.request({ method: "eth_chainId" })).toBe(numberToHex(fuji.id));
    });

    it("refuses a node on another chain and names both ids", async () => {
      const calls = stubRpc(node(() => numberToHex(otherTestnet.id)));
      const { send } = await connectOn(fuji);

      const sent = send();

      await expect(sent).rejects.toBeInstanceOf(WalletConnectionError);
      await expect(sent).rejects.toThrow(
        "Nothing was signed or sent: Avalanche Fuji is defined as chain 43113, but the node at " +
          "its rpcUrl reports chain 43113001. The temporary (burner) wallet signs only for the " +
          "chain its definition names. Make the definition's id and rpcUrl describe the same " +
          "chain, then try again.",
      );
      await expect(sent).rejects.not.toThrow(/mainnet/);
      expect(methods(calls)).toEqual(["eth_chainId"]);
    });

    it("refuses when the node cannot be asked, and asks again on the next send", async () => {
      let answer: () => unknown = () => {
        throw { code: -32601, message: "the method eth_chainId does not exist" };
      };
      const calls = stubRpc(node(() => answer()));
      const { send } = await connectOn(fuji);

      const first = send();
      await expect(first).rejects.toBeInstanceOf(WalletConnectionError);
      await expect(first).rejects.toThrow(
        /^Nothing was signed or sent: the temporary \(burner\) wallet could not confirm that the node at Avalanche Fuji's rpcUrl serves chain 43113\. Its eth_chainId request failed: .+ Check the RPC and try again\.$/,
      );
      await expect(send()).rejects.toThrow(/could not confirm/);

      // Nothing was remembered: each send asked, and neither got any further.
      expect(methods(calls)).toEqual(["eth_chainId", "eth_chainId"]);

      // Once the node answers, the same wallet sends.
      answer = () => numberToHex(fuji.id);
      expect(await send()).toBe(txHash);
      expect(count(calls, "eth_chainId")).toBe(3);
      expect(count(calls, "eth_sendRawTransaction")).toBe(1);
    });

    it.each([
      ["null", null],
      ["a decimal string", "43113"],
      ["an empty quantity", "0x"],
      ["a number", fuji.id],
      ["an object", { chainId: numberToHex(fuji.id) }],
    ])("treats %s as no answer, and never as a match", async (_label, malformed) => {
      const calls = stubRpc(node(() => malformed));
      const { send } = await connectOn(fuji);

      const first = send();
      await expect(first).rejects.toBeInstanceOf(WalletConnectionError);
      await expect(first).rejects.toThrow(/could not confirm .+ which is not a chain id\./);
      await expect(send()).rejects.toThrow(/could not confirm/);

      expect(methods(calls)).toEqual(["eth_chainId", "eth_chainId"]);
    });

    it("sends on a matching node, signed for the definition's id, and asks only once", async () => {
      const calls = stubRpc(node(() => numberToHex(fuji.id)));
      const { send } = await connectOn(fuji);

      expect(await send()).toBe(txHash);
      expect(await send()).toBe(txHash);

      const broadcast = calls.filter((call) => call.method === "eth_sendRawTransaction");
      expect(broadcast).toHaveLength(2);
      for (const call of broadcast) {
        const raw = call.params[0] as Hex;
        expect(parseTransaction(raw).chainId).toBe(fuji.id);
        expect(
          await recoverTransactionAddress({
            serializedTransaction: raw as Parameters<
              typeof recoverTransactionAddress
            >[0]["serializedTransaction"],
          }),
        ).toBe(TEST_ADDRESS);
      }
      // One question for the chain, not one per transaction, and it came first.
      expect(count(calls, "eth_chainId")).toBe(1);
      expect(calls[0]?.method).toBe("eth_chainId");
    });

    it("asks once for two sends started together", async () => {
      const calls = stubRpc(node(() => numberToHex(fuji.id)));
      const { send } = await connectOn(fuji);

      expect(await Promise.all([send(), send()])).toEqual([txHash, txHash]);

      expect(count(calls, "eth_chainId")).toBe(1);
      expect(count(calls, "eth_sendRawTransaction")).toBe(2);
    });

    it("checks again for the chain it is switched to", async () => {
      const calls = stubRpc(
        node((url) =>
          numberToHex(url === endpoint(otherTestnet.rpcUrl) ? otherTestnet.id : fuji.id),
        ),
      );
      const { provider, send } = await connectOn(fuji);
      const asked = (chain: AvaChain) =>
        calls.filter((call) => call.method === "eth_chainId" && call.url === endpoint(chain.rpcUrl))
          .length;

      await send();
      expect([asked(fuji), asked(otherTestnet)]).toEqual([1, 0]);

      await ensureChain(provider, otherTestnet);
      await send();
      await send();
      expect([asked(fuji), asked(otherTestnet)]).toEqual([1, 1]);

      // Back on the first chain the earlier answer is gone: it is asked again.
      await ensureChain(provider, fuji);
      await send();
      expect([asked(fuji), asked(otherTestnet)]).toEqual([2, 1]);

      // Asking for the chain the wallet is already on (apps call ensureChain
      // before every send) keeps the answer.
      await ensureChain(provider, fuji);
      await send();
      expect([asked(fuji), asked(otherTestnet)]).toEqual([2, 1]);

      // A switch forgets the answer even when nothing was sent in between.
      await ensureChain(provider, otherTestnet);
      await ensureChain(provider, fuji);
      await send();
      expect([asked(fuji), asked(otherTestnet)]).toEqual([3, 1]);
    });

    it("refuses on a chain it was switched to when that chain's node is a mainnet", async () => {
      const mislabelled = defineChain({ ...otherTestnet, name: "Mislabelled L1" });
      const calls = stubRpc(
        node((url) => numberToHex(url === endpoint(fuji.rpcUrl) ? fuji.id : cChain.id)),
      );
      const { provider, send } = await connectOn(fuji);
      await send();

      await ensureChain(provider, mislabelled);

      await expect(send()).rejects.toThrow(
        /Mislabelled L1 is defined as chain 43113001, but the node at its rpcUrl reports chain 43114, which is a mainnet/,
      );
      const broadcast = calls.filter((call) => call.method === "eth_sendRawTransaction");
      expect(broadcast.map((call) => call.url)).toEqual([endpoint(fuji.rpcUrl)]);
    });

    it("asks again when the same chain id moves to another RPC URL", async () => {
      const moved = defineChain({ ...fuji, rpcUrl: "https://rpc.fuji-mirror.example" });
      const calls = stubRpc(
        node((url) => numberToHex(url === endpoint(moved.rpcUrl) ? cChain.id : fuji.id)),
      );
      const { provider, send } = await connectOn(fuji);
      await send();

      await ensureChain(provider, moved);

      await expect(send()).rejects.toThrow(/reports chain 43114, which is a mainnet/);
      expect(count(calls, "eth_chainId")).toBe(2);
      expect(count(calls, "eth_sendRawTransaction")).toBe(1);
    });

    // A switch in the middle of a send must not carry the transaction over to
    // the new chain, nor let the old chain's answer count for the new one.
    it("keeps a send on the chain it was requested on when the wallet is switched meanwhile", async () => {
      const calls = stubRpc(
        node((url) =>
          numberToHex(url === endpoint(otherTestnet.rpcUrl) ? otherTestnet.id : fuji.id),
        ),
      );
      const { provider, send } = await connectOn(fuji);

      const onFuji = send();
      await ensureChain(provider, otherTestnet);
      await onFuji;
      await send();

      const broadcast = calls.filter((call) => call.method === "eth_sendRawTransaction");
      expect(
        broadcast.map((call) => [call.url, parseTransaction(call.params[0] as Hex).chainId]),
      ).toEqual([
        [endpoint(fuji.rpcUrl), fuji.id],
        [endpoint(otherTestnet.rpcUrl), otherTestnet.id],
      ]);
      expect(count(calls, "eth_chainId")).toBe(2);
    });

    // A check that fails late, for a chain the wallet has already left, must
    // not throw away the answer of the chain it is on now.
    it("keeps the current chain's answer when an earlier chain's check fails after a switch", async () => {
      const calls = stubRpc(
        node((url) => {
          if (url === endpoint(fuji.rpcUrl)) {
            throw { code: -32000, message: "node unavailable" };
          }
          return numberToHex(otherTestnet.id);
        }),
      );
      // Hold Fuji's answer back until the other chain's check has passed.
      const answer = globalThis.fetch;
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
        if (endpoint(url) === endpoint(fuji.rpcUrl)) {
          await held;
        }
        return answer(input, init);
      });
      const { provider, send } = await connectOn(fuji);

      const onFuji = send();
      await ensureChain(provider, otherTestnet);
      expect(await send()).toBe(txHash);
      release();
      await expect(onFuji).rejects.toThrow(/could not confirm/);
      expect(await send()).toBe(txHash);

      const asked = calls.filter(
        (call) => call.method === "eth_chainId" && call.url === endpoint(otherTestnet.rpcUrl),
      );
      expect(asked).toHaveLength(1);
    });

    // connect() must keep working offline and with a slow RPC, and a message
    // signature is not bound to the node's chain.
    it("asks the node nothing to connect, report its chain or sign a message", async () => {
      const calls = stubRpc(node(() => numberToHex(cChain.id)));
      const { adapter, provider } = await connectOn(fuji);

      expect(await provider.request({ method: "eth_chainId" })).toBe(numberToHex(fuji.id));
      const signature = (await provider.request({
        method: "personal_sign",
        params: ["0xdeadbeef", TEST_ADDRESS],
      })) as Hex;
      await adapter.switchChain?.(otherTestnet);

      expect(
        await verifyMessage({
          address: TEST_ADDRESS,
          message: { raw: "0xdeadbeef" },
          signature,
        }),
      ).toBe(true);
      expect(calls).toEqual([]);
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

  // "In memory only" still has to mean one wallet per adapter. Each connect()
  // used to generate a new key, so a reconnect (the React provider drops the
  // burner on a mainnet, for one) stranded the faucet drip on the old address.
  it("keeps one wallet across reconnects when persist is false, in memory only", async () => {
    const ls = mockStorage();
    vi.stubGlobal("localStorage", ls);
    const adapter = burnerAdapter({ persist: false });

    const first = await adapter.connect();
    await adapter.disconnect();
    const second = await adapter.connect();

    expect(second.address).toBe(first.address);
    expect(ls._store.size).toBe(0);

    // Another adapter, as after a reload, starts a fresh wallet.
    const other = await burnerAdapter({ persist: false }).connect();
    expect(other.address).not.toBe(first.address);
  });

  it("generates a fresh wallet on the next connect after clearBurner", async () => {
    vi.stubGlobal("localStorage", mockStorage());
    const adapter = burnerAdapter({});

    const first = await adapter.connect();
    await adapter.disconnect();
    clearBurner();
    const second = await adapter.connect();

    expect(second.address).not.toBe(first.address);
  });
});
