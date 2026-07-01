/**
 * Chain registry for AvaKit.
 *
 * M0 baseline: type-safe definitions for Fuji (testnet, default), C-Chain
 * (mainnet), and a `defineChain` helper for custom Avalanche L1s. Wallet
 * adapters, viem clients, and deploy helpers build on top of these in M1.
 */

export interface AvaChain {
  /** EVM chain id. */
  id: number;
  /** Human-readable name. */
  name: string;
  /** Primary JSON-RPC endpoint. */
  rpcUrl: string;
  /** Block explorer base URL. */
  explorerUrl: string;
  /** Faucet URL (testnets only). */
  faucetUrl?: string;
  /** Native currency metadata. */
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  /** True for testnets. Guards risky operations (mainnet requires opt-in). */
  testnet: boolean;
}

/** Define a custom Avalanche L1 / EVM chain. */
export function defineChain(config: AvaChain): AvaChain {
  return config;
}

/** Avalanche Fuji testnet (default development target). */
export const fuji: AvaChain = defineChain({
  id: 43113,
  name: "Avalanche Fuji",
  rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
  explorerUrl: "https://subnets-test.avax.network/c-chain",
  faucetUrl: "https://core.app/tools/testnet-faucet/",
  nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  testnet: true,
});

/** Avalanche C-Chain mainnet (opt-in; deploys require explicit confirmation). */
export const cChain: AvaChain = defineChain({
  id: 43114,
  name: "Avalanche C-Chain",
  rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
  explorerUrl: "https://subnets.avax.network/c-chain",
  nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  testnet: false,
});

/** Built-in chains keyed by a short slug. */
export const chains = {
  fuji,
  "c-chain": cChain,
} as const;

export type BuiltinChainSlug = keyof typeof chains;
