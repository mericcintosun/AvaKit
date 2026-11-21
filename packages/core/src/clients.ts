/**
 * viem client factory. Turns an AvaChain into viem public/wallet clients with
 * sensible Avalanche defaults. Wallet clients are created from an EIP-1193
 * provider supplied by a WalletAdapter, so signing happens in the wallet and no
 * key passes through here. (The burner adapter's provider is the one place
 * AvaKit itself holds a key: a throwaway, testnet-only one. See SECURITY.md.)
 */

import {
  type Chain,
  createPublicClient,
  createWalletClient,
  custom,
  type EIP1193Provider,
  fallback,
  http,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { type AvaChain, rpcEndpoints } from "./chains.js";

/**
 * How AvaKit talks to a chain's RPC endpoints. These are viem's own defaults
 * for one endpoint, written down here so a viem upgrade cannot change them
 * unnoticed, and arranged so that a second endpoint does not multiply them.
 *
 * - Every HTTP request to an endpoint gives up after `RPC_TIMEOUT_MS`.
 * - A call that fails is tried again up to `RPC_RETRY_COUNT` times, after
 *   waiting `RPC_RETRY_DELAY_MS`, then twice and four times that (150, 300,
 *   600 ms), unless the endpoint said how long to wait (`Retry-After`). Only
 *   failures that can pass are retried: a timeout, a network error, HTTP 403,
 *   408, 413, 429, 500, 502, 503 or 504, or a JSON-RPC rate limit or internal
 *   error. A revert, a rejected request or a bad parameter is not.
 * - With several endpoints, a failed request moves on to the next one at once,
 *   in the order listed, and each retry walks the list again from the first.
 *   The endpoints get no retries of their own: one endpoint that is down costs
 *   one failed request per attempt, not four.
 *
 * So a chain with N endpoints makes at most (1 + RPC_RETRY_COUNT) × N requests
 * for a call, each limited to RPC_TIMEOUT_MS. viem's latency ranking stays off:
 * it pings every endpoint for as long as the client lives, and AvaKit creates a
 * client per call (`getBalance`, `readContract`), so each call would start
 * another ranking loop that never stops.
 */
const RPC_TIMEOUT_MS = 10_000;
const RPC_RETRY_COUNT = 3;
const RPC_RETRY_DELAY_MS = 150;

/**
 * The transport for these endpoints (one at least), retried `retryCount`
 * times as described above. Internal: the burner adapter uses it to talk to
 * one endpoint at a time, and to forward reads without retrying them itself.
 */
export function transportFor(
  urls: readonly string[],
  retryCount: number = RPC_RETRY_COUNT,
): Transport {
  const [first, ...rest] = urls;
  if (first === undefined) {
    throw new Error("An RPC transport needs at least one endpoint URL.");
  }
  if (rest.length === 0) {
    return http(first, { timeout: RPC_TIMEOUT_MS, retryCount, retryDelay: RPC_RETRY_DELAY_MS });
  }
  return fallback(
    // No retryCount here: viem gives each endpoint of a fallback zero retries,
    // but a retryCount in an endpoint's own config would take precedence.
    urls.map((url) => http(url, { timeout: RPC_TIMEOUT_MS })),
    { rank: false, retryCount, retryDelay: RPC_RETRY_DELAY_MS },
  );
}

/**
 * The viem transport AvaKit reads a chain with: its RPC endpoints in the order
 * `rpcEndpoints` gives them, with a 10-second limit on every request and three
 * retries with backoff for a failed call. Pass it to your own viem (or wagmi)
 * clients to talk to the chain the same way `getPublicClient` does.
 */
export function getRpcTransport(chain: AvaChain): Transport {
  return transportFor(rpcEndpoints(chain));
}

/** Convert an AvaChain into the viem `Chain` shape. */
export function toViemChain(chain: AvaChain): Chain {
  return {
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: {
      // Primary first: viem's http() without a URL, and wallets given this
      // chain through viem's addChain, take the first entry as the default.
      default: { http: rpcEndpoints(chain) },
    },
    // No explorer (a fresh L1) means no `blockExplorers` at all: an entry with an
    // empty URL would reach the wallet as `blockExplorerUrls: [""]` through
    // viem's addChain, which wallets reject.
    ...(chain.explorerUrl
      ? { blockExplorers: { default: { name: "Explorer", url: chain.explorerUrl } } }
      : {}),
    testnet: chain.testnet,
  };
}

/**
 * Read-only client for the chain's RPC. When a request fails on an endpoint,
 * it moves on to the chain's next one (see `getRpcTransport`).
 */
export function getPublicClient(chain: AvaChain): PublicClient {
  return createPublicClient({
    chain: toViemChain(chain),
    transport: getRpcTransport(chain),
  });
}

/** Wallet client backed by an EIP-1193 provider (from a WalletAdapter). */
export function getWalletClient(chain: AvaChain, provider: EIP1193Provider): WalletClient {
  return createWalletClient({
    chain: toViemChain(chain),
    transport: custom(provider),
  });
}
