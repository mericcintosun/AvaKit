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
  /**
   * Block explorer base URL, without a trailing slash. Links are built as
   * `${explorerUrl}/tx/<hash>` and `${explorerUrl}/address/<address>`. Empty for
   * a chain that has no explorer (a fresh L1).
   */
  explorerUrl: string;
  /**
   * Faucet page for people (testnets only): a link to show, not an endpoint to
   * call. `requestFaucet` takes the URL of a faucet API instead, such as
   * `AVAKIT_FAUCET_URL`.
   */
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
 * True if deploying here spends real funds. Only a chain that explicitly says
 * `testnet: true` counts as a testnet, and not even then if its id is a known
 * mainnet — the id wins, so a mislabelled definition cannot bypass the mainnet
 * guard.
 *
 * Everything else is a mainnet. That includes `testnet: false`, and also a
 * definition from plain JavaScript or JSON that left the flag out or set it to
 * something that is not a boolean: the type requires the flag, but nothing
 * enforces a type at runtime, and a missing flag must fail closed rather than
 * skip the mainnet confirmation and let a burner wallet in.
 */
export function isMainnet(chain: AvaChain): boolean {
  return chain.testnet !== true || KNOWN_MAINNET_CHAIN_IDS.has(chain.id);
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

// Where the links below point, checked on 2026-11-18:
//
// - Explorer: Avalanche's explorer now lives on Builder Hub. The former hosts
//   (subnets-test.avax.network and subnets.avax.network) still answer, but only
//   by redirecting twice to the bases used here, so a link built from them
//   ended on a different site from the one it named. `/tx/<hash>` and
//   `/address/<address>` both resolve on these bases without a redirect.
// - Faucet: core.app/tools/testnet-faucet and faucet.avax.network both redirect
//   to the Builder Hub faucet. It asks for a free Builder Hub sign-in; the old
//   coupon code and mainnet-balance requirements are gone.

/** Avalanche Fuji testnet (default development target). */
export const fuji: AvaChain = defineChain({
  id: 43113,
  name: "Avalanche Fuji",
  rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
  explorerUrl: "https://build.avax.network/explorer/fuji/c-chain",
  faucetUrl: "https://build.avax.network/console/primary-network/faucet",
  nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  testnet: true,
});

/** Avalanche C-Chain mainnet (opt-in; deploys require explicit confirmation). */
export const cChain: AvaChain = defineChain({
  id: 43114,
  name: "Avalanche C-Chain",
  rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
  explorerUrl: "https://build.avax.network/explorer/mainnet/c-chain",
  nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  testnet: false,
});

/** Built-in chains keyed by a short slug. */
export const chains = {
  fuji,
  "c-chain": cChain,
} as const;

export type BuiltinChainSlug = keyof typeof chains;
