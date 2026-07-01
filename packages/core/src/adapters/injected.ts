import type { Address, EIP1193Provider } from "viem";
import { WalletConnectionError, WalletNotAvailableError } from "../errors.js";
import type { WalletAdapter, WalletConnection } from "./types.js";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export interface InjectedAdapterOptions {
  /** Override the provider (defaults to window.ethereum). Useful for testing. */
  provider?: EIP1193Provider;
  /** Display name. Defaults to "Browser Wallet". */
  name?: string;
}

/**
 * Injected EIP-1193 wallet adapter (Core, MetaMask, …).
 *
 * This is the fully-working default for M1 and needs no API keys. It works with
 * Core — the native Avalanche wallet — out of the box.
 */
export function injectedAdapter(options: InjectedAdapterOptions = {}): WalletAdapter {
  const provider: EIP1193Provider | null =
    options.provider ?? (typeof window !== "undefined" ? (window.ethereum ?? null) : null);

  return {
    id: "injected",
    name: options.name ?? "Browser Wallet (Core / MetaMask)",

    isAvailable() {
      return provider !== null;
    },

    async connect(): Promise<WalletConnection> {
      if (!provider) {
        throw new WalletNotAvailableError("injected");
      }
      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as Address[];
      const address = accounts[0];
      if (!address) {
        throw new WalletConnectionError("Wallet returned no accounts.");
      }
      return { address, provider };
    },

    async disconnect() {
      // Injected wallets manage their own session; nothing to tear down.
    },

    getProvider() {
      return provider;
    },
  };
}
