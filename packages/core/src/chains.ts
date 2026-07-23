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

/**
 * EVM chain ids that are always mainnet, whatever a config claims. Guards
 * against a definition that sets `testnet: true` on a known mainnet to slip
 * past the deploy confirmation. (security audit A9)
 */
export const KNOWN_MAINNET_CHAIN_IDS: ReadonlySet<number> = new Set([43114]);

/**
 * True if deploying here spends real funds. A chain counts as mainnet when it
 * says so (`testnet: false`) OR its id is a known mainnet — the id wins, so a
 * mislabelled definition cannot bypass the mainnet guard.
 */
export function isMainnet(chain: AvaChain): boolean {
  return chain.testnet === false || KNOWN_MAINNET_CHAIN_IDS.has(chain.id);
}

function assertHttpUrl(value: string | undefined, field: string): void {
  // Blank/undefined is allowed: a freshly launched L1 has no explorer or faucet
  // yet, and templates ship those fields empty. The check exists to reject
  // dangerous schemes (javascript:, file:), not to require every URL be present.
  if (!value) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${field}: "${value}" is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid ${field}: "${value}" must use http(s), not "${url.protocol}".`);
  }
}

/**
 * Define a custom Avalanche L1 / EVM chain. Validates that any URL present is
 * http(s) (no `javascript:`/`file:` reaching a client or fetch — audit A17) and
 * that a known mainnet id is never labelled a testnet (audit A9).
 */
export function defineChain(config: AvaChain): AvaChain {
  assertHttpUrl(config.rpcUrl, "rpcUrl");
  assertHttpUrl(config.explorerUrl, "explorerUrl");
  assertHttpUrl(config.faucetUrl, "faucetUrl");
  if (config.testnet && KNOWN_MAINNET_CHAIN_IDS.has(config.id)) {
    throw new Error(`Chain id ${config.id} is a known mainnet and cannot be marked testnet.`);
  }
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
