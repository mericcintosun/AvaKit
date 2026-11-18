import type { Address, EIP1193Provider } from "viem";
import type { WalletAdapter, WalletConnection } from "./adapters/types.js";
import type { AvaChain } from "./chains.js";
import { WalletConnectionError, WalletNotAvailableError } from "./errors.js";
import { ensureChain } from "./network.js";

/**
 * Coinbase Smart Wallet adapter — passkey sign-in, no dashboard, no client ID.
 *
 * The purest zero-config *real* wallet on Avalanche: the user signs in with a
 * passkey (WebAuthn), the smart account (ERC-4337) is created on first use, and
 * there is no app/extension to install and no API key to create. Offer it
 * alongside the burner (temporary) wallet as a keepable, self-custodial option.
 *
 * `@coinbase/wallet-sdk` is an optional peer dependency — only apps that use this
 * adapter install it (`npm install @coinbase/wallet-sdk`). It lives behind the
 * `@avakit/core/coinbase` subpath so the main `@avakit/core` entry never pulls
 * it in. Gasless on Avalanche needs your own paymaster (Coinbase's built-in
 * sponsorship is Base-only).
 */

export interface CoinbaseAdapterOptions {
  /** App name shown in the passkey prompt. */
  appName?: string;
  /** Chains to advertise; the first is the default. Pass your target, e.g. [fuji]. */
  chains?: AvaChain[];
  /** Wallet type preference. Default "smartWalletOnly" (passkey ERC-4337). */
  preference?: "smartWalletOnly" | "eoaOnly" | "all";
  /** Display name for UI. */
  name?: string;
}

// Minimal structural types so a version bump in the SDK can't break the build.
interface CoinbaseSdk {
  getProvider(): EIP1193Provider;
}
interface CoinbaseModule {
  createCoinbaseWalletSDK(options: Record<string, unknown>): CoinbaseSdk;
}

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** A passkey-based Coinbase Smart Wallet (ERC-4337). Needs `@coinbase/wallet-sdk`. */
export function coinbaseAdapter(options: CoinbaseAdapterOptions = {}): WalletAdapter {
  let provider: EIP1193Provider | null = null;

  async function ensureProvider(): Promise<EIP1193Provider> {
    if (provider) return provider;

    let mod: CoinbaseModule;
    try {
      // The specifier must stay a string literal. Bundlers (webpack, Vite,
      // Turbopack) only follow a dynamic import they can read statically, and a
      // browser cannot resolve a bare specifier on its own, so a computed one
      // leaves the SDK out of the app and makes every connect fail. Apps that
      // never import `@avakit/core/coinbase` never reach this file, so they
      // still do not need the SDK installed.
      mod = (await import("@coinbase/wallet-sdk")) as unknown as CoinbaseModule;
    } catch (cause) {
      throw new WalletNotAvailableError(
        "coinbase",
        'The passkey wallet needs the optional "@coinbase/wallet-sdk" package, which could ' +
          `not be loaded (${reason(cause)}). Install it with: npm install @coinbase/wallet-sdk`,
        { cause },
      );
    }

    // The SDK touches browser globals when it is constructed, so a server or
    // other non-browser caller fails here. That is not "no wallet available":
    // report it as a typed connection error that keeps the real reason, never
    // as a raw ReferenceError.
    let created: EIP1193Provider | null;
    try {
      const sdk = mod.createCoinbaseWalletSDK({
        appName: options.appName ?? "AvaKit app",
        appChainIds: (options.chains ?? []).map((c) => c.id),
        preference: { options: options.preference ?? "smartWalletOnly" },
      });
      created = sdk.getProvider();
    } catch (cause) {
      throw new WalletConnectionError(`Coinbase Smart Wallet could not start: ${reason(cause)}`, {
        cause,
      });
    }
    if (!created) {
      throw new WalletConnectionError("Coinbase Smart Wallet returned no provider.");
    }
    provider = created;
    return provider;
  }

  return {
    id: "coinbase",
    name: options.name ?? "Passkey wallet (Coinbase Smart Wallet)",

    isAvailable() {
      // Passkeys need a browser; the SDK is loaded lazily on connect().
      return typeof window !== "undefined";
    },

    async connect(): Promise<WalletConnection> {
      const eip = await ensureProvider();
      const accounts = (await eip.request({ method: "eth_requestAccounts" })) as Address[];
      const address = accounts[0];
      if (!address) {
        throw new WalletConnectionError("Coinbase Smart Wallet returned no accounts.");
      }
      return { address, provider: eip };
    },

    async disconnect() {
      try {
        await provider?.request?.({ method: "wallet_disconnect" } as never);
      } catch {
        // best-effort; some builds don't implement wallet_disconnect
      }
      provider = null;
    },

    getProvider() {
      return provider;
    },

    async switchChain(chain: AvaChain) {
      if (provider) await ensureChain(provider, chain);
    },
  };
}
