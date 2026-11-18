import type { EIP1193Provider } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fuji } from "./chains.js";
import { coinbaseAdapter } from "./coinbase.js";
import { AvaKitError, WalletConnectionError, WalletNotAvailableError } from "./errors.js";

const ACCOUNT = "0x000000000000000000000000000000000000dEaD";

/** Stand in for the optional `@coinbase/wallet-sdk` on the adapter's next import. */
function mockSdk(factory: () => Record<string, unknown>) {
  vi.doMock("@coinbase/wallet-sdk", factory);
}

/** An SDK whose provider answers eth_requestAccounts with `accounts`. */
function workingSdk(accounts: string[] = [ACCOUNT]) {
  const provider = {
    request: vi.fn(async ({ method }: { method: string }) =>
      method === "eth_requestAccounts" ? accounts : null,
    ),
  } as unknown as EIP1193Provider;
  const createCoinbaseWalletSDK = vi.fn(() => ({ getProvider: () => provider }));
  mockSdk(() => ({ createCoinbaseWalletSDK }));
  return { provider, createCoinbaseWalletSDK };
}

function methodsRequested(provider: EIP1193Provider): string[] {
  return (
    provider.request as unknown as { mock: { calls: [{ method: string }][] } }
  ).mock.calls.map((call) => call[0].method);
}

beforeEach(() => {
  // The adapter imports the SDK lazily; forget the cached copy between tests.
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@coinbase/wallet-sdk");
  vi.unstubAllGlobals();
});

describe("coinbaseAdapter", () => {
  it("has a stable id and a passkey label", () => {
    const adapter = coinbaseAdapter();
    expect(adapter.id).toBe("coinbase");
    expect(adapter.name).toMatch(/passkey/i);
  });

  it("is unavailable without a browser (no window)", () => {
    expect(coinbaseAdapter().isAvailable()).toBe(false);
  });

  it("is available in a browser-like environment", () => {
    vi.stubGlobal("window", {});
    expect(coinbaseAdapter().isAvailable()).toBe(true);
  });

  it("connects through the SDK's provider and passes the app's options", async () => {
    const { provider, createCoinbaseWalletSDK } = workingSdk();
    const adapter = coinbaseAdapter({ appName: "My app", chains: [fuji] });

    const connection = await adapter.connect();

    expect(connection.address).toBe(ACCOUNT);
    expect(connection.provider).toBe(provider);
    expect(adapter.getProvider()).toBe(provider);
    expect(createCoinbaseWalletSDK).toHaveBeenCalledWith({
      appName: "My app",
      appChainIds: [fuji.id],
      preference: { options: "smartWalletOnly" },
    });
  });

  it("creates the SDK once and reuses its provider on later connects", async () => {
    const { createCoinbaseWalletSDK } = workingSdk();
    const adapter = coinbaseAdapter();

    await adapter.connect();
    await adapter.connect();

    expect(createCoinbaseWalletSDK).toHaveBeenCalledTimes(1);
  });

  // A missing optional dependency is the one case that means "not available",
  // and the advice has to be about the package, not about browser wallets.
  it("reports a missing SDK as not available, with the install command", async () => {
    mockSdk(() => {
      throw new Error("Cannot find package '@coinbase/wallet-sdk'");
    });

    const connecting = coinbaseAdapter().connect();

    await expect(connecting).rejects.toBeInstanceOf(WalletNotAvailableError);
    await expect(connecting).rejects.toThrow("npm install @coinbase/wallet-sdk");
    await expect(connecting).rejects.not.toThrow(/Install a browser wallet/);
    await expect(connecting).rejects.toHaveProperty("cause");
  });

  // The SDK touches browser globals when constructed. That failure used to be
  // reported as "no wallet available: install a browser wallet", hiding the cause.
  it("reports an SDK that cannot start as a connection error that keeps the reason", async () => {
    const failure = new ReferenceError("window is not defined");
    mockSdk(() => ({
      createCoinbaseWalletSDK: () => {
        throw failure;
      },
    }));

    const connecting = coinbaseAdapter().connect();

    await expect(connecting).rejects.toBeInstanceOf(WalletConnectionError);
    await expect(connecting).rejects.not.toBeInstanceOf(WalletNotAvailableError);
    await expect(connecting).rejects.toThrow("window is not defined");
    await expect(connecting).rejects.toHaveProperty("cause", failure);
  });

  it("reports a wallet that returns no accounts as a connection error", async () => {
    workingSdk([]);
    await expect(coinbaseAdapter().connect()).rejects.toBeInstanceOf(WalletConnectionError);
  });

  // Outside a browser the real SDK blows up on browser globals; either way the
  // caller must get a typed AvaKit error, never a raw ReferenceError.
  it("throws a typed error when the real SDK runs outside a browser", async () => {
    await expect(coinbaseAdapter().connect()).rejects.toBeInstanceOf(AvaKitError);
  });

  it("switches chains through the connected provider", async () => {
    const { provider } = workingSdk();
    const adapter = coinbaseAdapter();
    await adapter.connect();

    await adapter.switchChain?.(fuji);

    expect(methodsRequested(provider)).toContain("wallet_switchEthereumChain");
  });

  it("asks the wallet to disconnect and forgets the provider", async () => {
    const { provider } = workingSdk();
    const adapter = coinbaseAdapter();
    await adapter.connect();

    await adapter.disconnect();

    expect(methodsRequested(provider)).toContain("wallet_disconnect");
    expect(adapter.getProvider()).toBeNull();
  });
});
