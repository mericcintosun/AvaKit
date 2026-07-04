import type { Address, EIP1193Provider } from "viem";
import type { AvaChain } from "../chains.js";

/** Result of a successful wallet connection. */
export interface WalletConnection {
  address: Address;
  provider: EIP1193Provider;
}

/**
 * Wallet provider abstraction.
 *
 * An adapter only ever exposes an EIP-1193 provider (a signing interface).
 * Private keys never pass through AvaKit code — they stay inside the provider
 * (an injected wallet, or a social-login provider's HSM/enclave).
 */
export interface WalletAdapter {
  /** Stable identifier, e.g. "injected" or "web3auth". */
  readonly id: string;
  /** Human-readable label for UI. */
  readonly name: string;
  /** Whether this adapter can be used in the current environment. */
  isAvailable(): boolean | Promise<boolean>;
  /**
   * Optional human-readable reason this adapter is unavailable (e.g. a missing
   * client ID). UIs can show it instead of silently hiding the adapter. Only
   * meaningful when `isAvailable()` returns false.
   */
  readonly unavailableReason?: string;
  /** Prompt the user to connect; resolves with their address + provider. */
  connect(): Promise<WalletConnection>;
  /** Disconnect / log out. */
  disconnect(): Promise<void>;
  /** The current EIP-1193 provider, or null if not connected. */
  getProvider(): EIP1193Provider | null;
  /**
   * Optional adapter-specific chain switch. Embedded wallets (Web3Auth) need
   * their own SDK call instead of the EIP-1193 `wallet_switchEthereumChain`
   * RPC. When omitted, callers fall back to the generic `ensureChain`.
   */
  switchChain?(chain: AvaChain): Promise<void>;
}
