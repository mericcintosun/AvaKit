import type { Address, EIP1193Provider } from "viem";
import type { AvaChain } from "../chains.js";
import { WalletConnectionError, WalletNotAvailableError } from "../errors.js";
import type { WalletAdapter, WalletConnection } from "./types.js";

/**
 * Web3Auth (MetaMask Embedded Wallets) social-login adapter — AvaKit's default
 * onboarding path. Wraps `@web3auth/modal` and exposes only an EIP-1193
 * provider; keys stay inside Web3Auth's HSM-backed infrastructure.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⚠️  LIVE-VALIDATION PENDING. This is written against the documented
 *     @web3auth/modal v11 flow but has NOT been run end-to-end (a free
 *     NEXT_PUBLIC_WEB3AUTH_CLIENT_ID and a browser are required). The v11
 *     constructor/config surface is version-sensitive — if a future SDK build
 *     changes it, only this file needs adjusting. The injected adapter is the
 *     verified M1 default. See docs/04-adr.md (ADR-011).
 * ──────────────────────────────────────────────────────────────────────────
 *
 * `@web3auth/modal` is an optional peer dependency: only consumers that use
 * this adapter need to install it.
 */

export interface Web3AuthAdapterOptions {
  /** Web3Auth client ID (free, from the Web3Auth / MetaMask developer dashboard). */
  clientId: string;
  /** Network. Defaults to "sapphire_devnet" for testing, "sapphire_mainnet" for production. */
  network?: "sapphire_devnet" | "sapphire_mainnet";
  /** Display name for UI. */
  name?: string;
}

// Minimal structural types — we intentionally do not couple to the SDK's exact
// generics so a type-level change in the SDK can't break AvaKit's build.
interface Web3AuthInstance {
  init(): Promise<void>;
  connect(): Promise<unknown>;
  logout(): Promise<void>;
  addChain(config: Record<string, unknown>): Promise<void>;
  switchChain(params: { chainId: string }): Promise<void>;
  connected: boolean;
  provider: unknown;
}
interface Web3AuthModule {
  Web3Auth: new (options: Record<string, unknown>) => Web3AuthInstance;
}

export function web3authAdapter(options: Web3AuthAdapterOptions): WalletAdapter {
  const network = options.network ?? "sapphire_devnet";
  let instance: Web3AuthInstance | null = null;
  let provider: EIP1193Provider | null = null;

  async function ensureInstance(): Promise<Web3AuthInstance> {
    if (instance) return instance;
    let mod: Web3AuthModule;
    try {
      mod = (await import("@web3auth/modal")) as unknown as Web3AuthModule;
    } catch {
      throw new WalletNotAvailableError("web3auth");
    }
    instance = new mod.Web3Auth({
      clientId: options.clientId,
      web3AuthNetwork: network,
    });
    await instance.init();
    return instance;
  }

  return {
    id: "web3auth",
    name: options.name ?? "Social login (Google, Apple, email)",

    isAvailable() {
      return Boolean(options.clientId);
    },

    async connect(): Promise<WalletConnection> {
      const web3auth = await ensureInstance();
      const connected = await web3auth.connect();
      const eip = (connected ?? web3auth.provider) as EIP1193Provider | null;
      if (!eip) {
        throw new WalletConnectionError("Web3Auth returned no provider.");
      }
      provider = eip;
      const accounts = (await eip.request({ method: "eth_accounts" })) as Address[];
      const address = accounts[0];
      if (!address) {
        throw new WalletConnectionError("Web3Auth returned no accounts.");
      }
      return { address, provider };
    },

    async disconnect() {
      if (instance?.connected) {
        await instance.logout();
      }
      provider = null;
    },

    getProvider() {
      return provider;
    },

    async switchChain(chain: AvaChain) {
      const web3auth = await ensureInstance();
      const chainId = `0x${chain.id.toString(16)}`;
      // addChain is idempotent-ish; ignore "already added" failures.
      try {
        await web3auth.addChain({
          chainNamespace: "eip155",
          chainId,
          rpcTarget: chain.rpcUrl,
          displayName: chain.name,
          blockExplorerUrl: chain.explorerUrl,
          ticker: chain.nativeCurrency.symbol,
          tickerName: chain.nativeCurrency.name,
        });
      } catch {
        // chain likely already registered
      }
      await web3auth.switchChain({ chainId });
      // Refresh the cached provider; Web3Auth updates it on chain switch.
      provider = (web3auth.provider as EIP1193Provider | null) ?? provider;
    },
  };
}
