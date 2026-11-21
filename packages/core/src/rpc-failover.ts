/**
 * When a request moves on from one of a chain's RPC endpoints to the next, and
 * what it reports when it has failed at all of them. Internal, apart from
 * `RpcEndpointsError`, which the package exports.
 */

import { BaseError, HttpRequestError, RpcRequestError, shouldThrow, TimeoutError } from "viem";

/**
 * An RPC endpoint as a message names it: its origin (scheme, host and port)
 * and nothing more. RPC URLs often hold a secret, a password in the user part
 * or an API key in the path or the query (Infura's `/v3/<key>`, Alchemy's
 * `/v2/<key>`), and messages end up on screens and in logs.
 */
export function shownEndpoint(url: string): string {
  try {
    const { origin } = new URL(url);
    // "null" for a URL without a host, which an http(s) URL always has.
    return origin === "null" ? "an RPC endpoint" : origin;
  } catch {
    return "an RPC endpoint";
  }
}

/**
 * JSON-RPC error codes with which a node says that it cannot serve a request,
 * rather than answering it: an internal error (-32603), a resource that is
 * unavailable (-32002) or not found (-32001, from a node that has not seen the
 * block yet), a method it does not offer (-32601, -32004), and a limit or rate
 * limit (-32005, 429, and QuickNode's -32007).
 */
const CANNOT_SERVE_CODES: ReadonlySet<number> = new Set([
  -32603, -32002, -32001, -32601, -32004, -32005, 429, -32007,
]);

/**
 * What a node says, under any code, when it cannot serve a request now: it is
 * behind (still syncing or indexing, without the block or the state asked
 * for), busy or overloaded, out of time, over a rate limit, or its transaction
 * pool is full. Geth and Avalanche's nodes answer "header not found" with
 * -32000, the code they also use for "nonce too low", so the code alone cannot
 * tell.
 */
const CANNOT_SERVE_WORDS =
  /header not found|missing trie node|unknown block|not synced|syncing|indexing|timed? ?out|timeout|deadline exceeded|rate.?limit|too many requests|busy|overloaded|unavailable|txpool is full/i;

/** HTTP statuses with which an endpoint, not the node behind it, turns a request away. */
function turnedAway(status: number | undefined): boolean {
  return status !== undefined && (status >= 500 || [401, 403, 404, 408, 413, 429].includes(status));
}

/**
 * Whether a request that failed at one of a chain's RPC endpoints stops there,
 * rather than moving on to the next endpoint. It is viem's fallback
 * `shouldThrow` for AvaKit's transports.
 *
 * It stops when the node answered and any node of the chain would have
 * answered the same: a revert, a transaction refused for what it is ("nonce
 * too low", "insufficient funds", "replacement transaction underpriced",
 * "already known"), a bad parameter. It moves on when no answer came back (the
 * endpoint could not be reached, did not answer in time, or answered with an
 * HTTP error), or when the answer says that this node cannot serve the request:
 * an internal error, a limit, a method it does not offer, a block it has not
 * caught up with.
 *
 * So the next endpoint is asked only when the one before it failed. A healthy
 * endpoint's answer is reported as it gave it, and a raw transaction that one
 * node rejected is not handed to another.
 */
export function stopsAtEndpoint(error: Error): boolean {
  // viem's own rule (a revert, a rejected transaction, the user's refusal),
  // and a request its caller has given up on.
  if (shouldThrow(error) || error.name === "AbortError") {
    return true;
  }
  const answer =
    error instanceof BaseError ? error.walk((cause) => cause instanceof RpcRequestError) : null;
  if (!(answer instanceof RpcRequestError)) {
    return false;
  }
  return !(
    turnedAway(answer.status) ||
    CANNOT_SERVE_CODES.has(answer.code) ||
    CANNOT_SERVE_WORDS.test(answer.details ?? "")
  );
}

/** At most `limit` characters of `text`, on one line. */
function clipped(text: string, limit = 80): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/** Why one endpoint failed, as the words that follow its name in a message. */
function failedHow(error: Error): string {
  const step = (match: (cause: unknown) => boolean) =>
    error instanceof BaseError ? error.walk(match) : null;
  if (step((cause) => cause instanceof TimeoutError)) {
    return "did not answer in time";
  }
  const answer = step((cause) => cause instanceof RpcRequestError);
  if (answer instanceof RpcRequestError) {
    const said = clipped(answer.details ?? "");
    return answer.status ? `answered HTTP ${answer.status} (${said})` : `answered "${said}"`;
  }
  const http = step((cause) => cause instanceof HttpRequestError);
  if (http instanceof HttpRequestError) {
    return http.status ? `answered HTTP ${http.status}` : "could not be reached";
  }
  const short = error instanceof BaseError ? error.shortMessage : error.message;
  return `failed (${clipped(short)})`;
}

/**
 * A request that failed at every RPC endpoint of a chain, each time in a way
 * that another endpoint might not have (no answer, no answer in time, an HTTP
 * error, a node that was busy or behind). An answer about the request itself,
 * such as a revert, is not one of these: it comes back as the node gave it.
 *
 * The message names each endpoint by its origin only (a URL can hold a password
 * or an API key) and says how it failed. `failures` holds each endpoint's URL
 * and error in the order they were tried, and `cause` is the error viem
 * reported for the last one.
 */
export class RpcEndpointsError extends BaseError {
  override name = "RpcEndpointsError" as const;
  /** Every endpoint, in the order tried, with the error it failed with last. */
  readonly failures: readonly { readonly url: string; readonly error: Error }[];

  constructor(
    failures: readonly { readonly url: string; readonly error: Error }[],
    options: { chainName?: string | undefined; cause?: Error | undefined } = {},
  ) {
    const each = failures.map(({ url, error }) => `${shownEndpoint(url)} ${failedHow(error)}`);
    super(`Every RPC endpoint of ${options.chainName ?? "the chain"} failed: ${each.join("; ")}.`, {
      cause: options.cause ?? failures.at(-1)?.error,
      name: "RpcEndpointsError",
    });
    this.failures = failures;
  }
}
