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
  type EIP1193RequestFn,
  type FallbackTransport,
  fallback,
  http,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { type AvaChain, rpcEndpoints } from "./chains.js";
import { RpcEndpointsError, stopsAtEndpoint } from "./rpc-failover.js";

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
 * - With several endpoints, a request that an endpoint fails moves on to the
 *   next one at once, in the order listed, and each retry walks the list again
 *   from the first. An endpoint fails a request when it cannot be reached, does
 *   not answer in time, answers with an HTTP error, or answers that it cannot
 *   serve the request (busy, behind, over a limit, no such method): see
 *   `stopsAtEndpoint`. Any other answer, such as a revert or a rejected
 *   transaction, is the chain's answer and is returned as it is. The endpoints
 *   get no retries of their own: one endpoint that is down costs one failed
 *   request per attempt, not four.
 * - A call that fails at every endpoint rejects with `RpcEndpointsError`,
 *   which names each endpoint and how it failed.
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

/** What viem's fallback transport tells its `onResponse` listener about each attempt. */
type FallbackResponse = Parameters<
  Parameters<NonNullable<ReturnType<FallbackTransport>["value"]>["onResponse"]>[0]
>[0];

/** The rejections already turned into an `RpcEndpointsError`, by the error viem rejected with. */
const reported = new WeakMap<object, RpcEndpointsError>();

/**
 * Transports made so far: each gets its own `uid` for viem's deduplication of
 * requests in flight, shared by the calls of one client and not by two.
 */
let transportCount = 0;

/**
 * viem's fallback over several endpoints, as described above, with one
 * addition: a call that fails at every endpoint rejects with an
 * `RpcEndpointsError` that names them all, where viem's fallback rejects with
 * the last endpoint's error alone.
 *
 * Every call gets a fallback of its own, whose `onResponse` collects what each
 * endpoint answered for that call alone: one listener shared by concurrent
 * calls could not tell their attempts apart. The calls of one client keep one
 * `uid`, so viem still serves identical requests in flight with one request.
 */
function fallbackOver(urls: readonly string[], retryCount: number): Transport {
  const walk = fallback(
    // No retryCount here: viem gives each endpoint of a fallback zero retries,
    // but a retryCount in an endpoint's own config would take precedence.
    urls.map((url) => http(url, { timeout: RPC_TIMEOUT_MS })),
    { rank: false, retryCount, retryDelay: RPC_RETRY_DELAY_MS, shouldThrow: stopsAtEndpoint },
  );
  return (parameters) => {
    const { config, value } = walk(parameters);
    transportCount += 1;
    const uid = `avakit-rpc-${transportCount}`;
    let listener: ((response: FallbackResponse) => void) | undefined;

    const request = (async (args, options) => {
      const failed = new Map<string, Error>();
      const call = walk(parameters);
      call.value?.onResponse((response) => {
        const url: unknown = response.transport.value?.url;
        if (response.status === "error" && typeof url === "string") {
          failed.set(url, response.error);
        }
        listener?.(response);
      });
      try {
        return await call.request(args, { ...options, uid: options?.uid ?? uid });
      } catch (error) {
        if (typeof error !== "object" || error === null) {
          throw error;
        }
        // Another call that was served by the same request reported it already.
        const known = reported.get(error);
        if (known) {
          throw known;
        }
        // Stopped by the chain's answer or by the caller, or not every
        // endpoint was tried: the error stands as viem gave it.
        if (
          options?.signal?.aborted ||
          !(error instanceof Error) ||
          stopsAtEndpoint(error) ||
          !urls.every((url) => failed.has(url))
        ) {
          throw error;
        }
        const everywhere = new RpcEndpointsError(
          urls.map((url) => ({ url, error: failed.get(url) as Error })),
          { chainName: parameters.chain?.name, cause: error },
        );
        reported.set(error, everywhere);
        throw everywhere;
      }
    }) as EIP1193RequestFn;

    return {
      config,
      request,
      value: {
        ...value,
        // viem's fallback takes one listener for every attempt; so does this.
        onResponse: (fn: (response: FallbackResponse) => void) => {
          listener = fn;
        },
      },
    };
  };
}

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
  return fallbackOver(urls, retryCount);
}

/**
 * The viem transport AvaKit reads a chain with: its RPC endpoints in the order
 * `rpcEndpoints` gives them, with a 10-second limit on every request and three
 * retries with backoff for a failed call. Pass it to your own viem (or wagmi)
 * clients to talk to the chain the same way `getPublicClient` does.
 *
 * A request moves on to the chain's next endpoint only when one fails it (no
 * answer, no answer in time, an HTTP error, or a node that cannot serve it
 * now); a node's answer about the request itself, such as a revert or a
 * rejected transaction, is returned as it gave it. A call that fails at every
 * endpoint of a chain with several rejects with `RpcEndpointsError`, which
 * names each endpoint by its origin and says how it failed; its `cause` is
 * viem's error for the last one. A chain with one endpoint rejects with viem's
 * error for it, as a plain `http` transport does.
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
 * Read-only client for the chain's RPC. When an endpoint fails a request, it
 * moves on to the chain's next one (see `getRpcTransport`).
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
