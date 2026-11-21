import {
  BaseError,
  HttpRequestError,
  InternalRpcError,
  InvalidInputRpcError,
  InvalidParamsRpcError,
  LimitExceededRpcError,
  MethodNotFoundRpcError,
  RpcRequestError,
  TimeoutError,
  TransactionRejectedRpcError,
  UserRejectedRequestError,
} from "viem";
import { describe, expect, it } from "vitest";
import { RpcEndpointsError, shownEndpoint, stopsAtEndpoint } from "./rpc-failover.js";

const URL_A = "https://a.example/rpc";

/** A JSON-RPC error a node answered with, as viem's http transport reports it. */
function answered(code: number, message: string, status?: number): RpcRequestError {
  return new RpcRequestError({ body: {}, error: { code, message }, status, url: URL_A });
}

describe("shownEndpoint", () => {
  it("shows the origin and nothing that could be a secret", () => {
    expect(shownEndpoint("https://user:s3cret@rpc.example.com:8545/v3/KEY?key=Q#f")).toBe(
      "https://rpc.example.com:8545",
    );
    expect(shownEndpoint("https://api.avax-test.network/ext/bc/C/rpc")).toBe(
      "https://api.avax-test.network",
    );
    expect(shownEndpoint("http://127.0.0.1:9650/ext/bc/abc/rpc")).toBe("http://127.0.0.1:9650");
  });

  it("does not echo what it cannot read as a URL", () => {
    expect(shownEndpoint("not a url, maybe a key")).toBe("an RPC endpoint");
  });
});

describe("stopsAtEndpoint", () => {
  // Nothing came back from the endpoint itself: another one may well answer.
  it.each([
    ["it could not be reached", new HttpRequestError({ url: URL_A, cause: new Error("x") })],
    ["it answered HTTP 503", new HttpRequestError({ url: URL_A, status: 503 })],
    [
      "it answered HTTP 400 without a JSON-RPC error",
      new HttpRequestError({ url: URL_A, status: 400 }),
    ],
    ["it did not answer in time", new TimeoutError({ body: {}, url: URL_A })],
    ["the error is not viem's", new Error("socket hang up")],
  ])("moves on when %s", (_label, error) => {
    expect(stopsAtEndpoint(error)).toBe(false);
  });

  // The node answered, but only to say that it cannot serve the request now.
  it.each([
    ["an internal error", new InternalRpcError(answered(-32603, "internal error"))],
    ["a limit", new LimitExceededRpcError(answered(-32005, "limit exceeded"))],
    ["an unknown method", new MethodNotFoundRpcError(answered(-32601, "no such method"))],
    ["a rate limit by code", answered(429, "Too Many Requests")],
    ["QuickNode's rate limit", answered(-32007, "10/second request limit reached")],
    ["a block it has not seen", new InvalidInputRpcError(answered(-32000, "header not found"))],
    ["missing state", new InvalidInputRpcError(answered(-32000, "missing trie node abc"))],
    ["a timeout", new InvalidInputRpcError(answered(-32000, "execution aborted (timeout = 5s)"))],
    ["a full pool", new InvalidInputRpcError(answered(-32000, "txpool is full"))],
    [
      "an index still being built",
      new InvalidInputRpcError(answered(-32000, "transaction indexing is in progress")),
    ],
    ["a node that is syncing", new InvalidInputRpcError(answered(-32000, "node is syncing"))],
    ["an HTTP 429 with any JSON-RPC error", answered(-32000, "slow down", 429)],
    ["an HTTP 503 with any JSON-RPC error", answered(-32000, "nonce too low", 503)],
  ])("moves on from %s", (_label, error) => {
    expect(stopsAtEndpoint(error)).toBe(false);
  });

  // The chain's answer to the request: the same on every node.
  it.each([
    ["a revert", answered(3, "execution reverted: sold out")],
    ["a revert without data", new InvalidInputRpcError(answered(-32000, "execution reverted"))],
    ["nonce too low", new InvalidInputRpcError(answered(-32000, "nonce too low"))],
    ["already known", new InvalidInputRpcError(answered(-32000, "already known"))],
    [
      "an underpriced replacement",
      new InvalidInputRpcError(answered(-32000, "replacement transaction underpriced")),
    ],
    [
      "insufficient funds",
      new InvalidInputRpcError(answered(-32000, "insufficient funds for gas * price + value")),
    ],
    ["a bad parameter", new InvalidParamsRpcError(answered(-32602, "invalid argument 0"))],
    ["a bad parameter with HTTP 400", answered(-32602, "invalid argument 0", 400)],
    ["a rejected transaction", new TransactionRejectedRpcError(answered(-32003, "rejected"))],
    ["the user's refusal", new UserRejectedRequestError(new Error("User rejected the request."))],
    ["an abort", new DOMException("This operation was aborted", "AbortError")],
  ])("stops at %s", (_label, error) => {
    expect(stopsAtEndpoint(error as Error)).toBe(true);
  });
});

describe("RpcEndpointsError", () => {
  it("names every endpoint in order, by origin, with how it failed", () => {
    const failures = [
      {
        url: "https://user:pw@a.example/v2/KEY",
        error: new TimeoutError({ body: {}, url: URL_A }),
      },
      { url: "https://b.example/?apikey=K", error: answered(-32000, "slow down", 429) },
      {
        url: "https://c.example/rpc",
        error: new InvalidInputRpcError(answered(-32000, "header not found")),
      },
      { url: "not a url", error: new Error("something odd\n  happened") },
    ];

    const error = new RpcEndpointsError(failures);

    expect(error).toBeInstanceOf(BaseError);
    expect(error.name).toBe("RpcEndpointsError");
    expect(error.shortMessage).toBe(
      "Every RPC endpoint of the chain failed: https://a.example did not answer in time; " +
        "https://b.example answered HTTP 429 (slow down); https://c.example answered " +
        '"header not found"; an RPC endpoint failed (something odd happened).',
    );
    expect(error.failures).toBe(failures);
    // viem's error for the last endpoint, unless the caller names another.
    expect(error.cause).toBe(failures[3]?.error);
    for (const secret of ["user", "pw", "KEY", "apikey", "/v2/", "/rpc"]) {
      expect(error.shortMessage).not.toContain(secret);
    }
  });

  it("uses the chain's name, and the cause it is given", () => {
    const last = new HttpRequestError({ url: URL_A, status: 502 });
    const error = new RpcEndpointsError(
      [
        { url: "https://a.example", error: new HttpRequestError({ url: URL_A, status: 503 }) },
        { url: "https://b.example", error: last },
      ],
      { chainName: "Avalanche Fuji", cause: last },
    );

    expect(error.shortMessage).toBe(
      "Every RPC endpoint of Avalanche Fuji failed: https://a.example answered HTTP 503; " +
        "https://b.example answered HTTP 502.",
    );
    expect(error.cause).toBe(last);
    expect(error.walk((cause) => cause instanceof HttpRequestError)).toBe(last);
  });
});
