import type { Address, EIP1193Provider } from "viem";
import type { AvaChain } from "../chains.js";
import { WalletConnectionError, WalletNotAvailableError } from "../errors.js";
import { ensureChain } from "../network.js";
import type { WalletAdapter, WalletConnection } from "./types.js";

/**
 * Web3Auth (MetaMask Embedded Wallets) social-login adapter — AvaKit's default
 * onboarding path. Wraps `@web3auth/modal` and exposes only an EIP-1193
 * provider; keys stay inside Web3Auth's HSM-backed infrastructure.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⚠️  LIVE-VALIDATION PENDING (needs a human Google sign-in in a browser).
 *     Aligned to @web3auth/modal v11.2.0's real API: `connect()` resolves to a
 *     Connection whose `ethereumProvider` is the EIP-1193 provider, and chains
 *     are configured via the Web3Auth dashboard (add the target chain there, or
 *     rely on the addChain/switchChain fallback below). A free
 *     NEXT_PUBLIC_WEB3AUTH_CLIENT_ID is required. The injected adapter is the
 *     end-to-end-verified default. See docs/04-adr.md (ADR-011).
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
/** v11 `connect()` resolves to a Connection; the EIP-1193 provider is on it. */
interface Web3AuthConnection {
  ethereumProvider?: EIP1193Provider | null;
}
interface Web3AuthInstance {
  init(): Promise<void>;
  connect(): Promise<Web3AuthConnection | null>;
  logout(): Promise<void>;
  addChain?(config: Record<string, unknown>): Promise<void>;
  switchChain(params: { chainId: string }): Promise<void>;
  connected: boolean;
  provider: EIP1193Provider | null;
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
      // v11: connect() resolves to a Connection whose `ethereumProvider` is the
      // EIP-1193 provider; older/edge cases expose it as `web3auth.provider`.
      const connection = await web3auth.connect();
      const eip = connection?.ethereumProvider ?? web3auth.provider;
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
      // Register the chain if the SDK build supports dynamic addChain (harmless
      // if it's already known or the method is absent).
      try {
        await web3auth.addChain?.({
          chainNamespace: "eip155",
          chainId,
          rpcTarget: chain.rpcUrl,
          displayName: chain.name,
          blockExplorerUrl: chain.explorerUrl,
          ticker: chain.nativeCurrency.symbol,
          tickerName: chain.nativeCurrency.name,
        });
      } catch {
        // chain likely already registered, or addChain not in this build
      }
      try {
        await web3auth.switchChain({ chainId });
        provider = web3auth.provider ?? provider;
      } catch {
        // Fall back to generic EIP-1193 chain switching (add + switch) on the
        // provider — covers builds where the chain must be added at the RPC layer.
        if (provider) await ensureChain(provider, chain);
      }
    },
  };
}
