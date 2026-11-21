/**
 * Test helper (never shipped: no entry point imports it). Answers JSON-RPC over
 * a stubbed global `fetch`, so code that reaches a chain through viem's http
 * transport runs without touching the network. Undo it with
 * `vi.unstubAllGlobals()` in an `afterEach`.
 */

import { vi } from "vitest";

export interface RpcCall {
  /** RPC endpoint the request was sent to, normalised (see `endpoint`). */
  url: string;
  method: string;
  params: unknown[];
}

/**
 * Normalise an RPC URL the way `fetch` sees it ("https://host" becomes
 * "https://host/"), so a chain's `rpcUrl` can be compared with `RpcCall.url`.
 */
export function endpoint(rpcUrl: string): string {
  return new URL(rpcUrl).href;
}

/**
 * One handler per JSON-RPC method. Return the `result`, or throw an object with
 * `code` and `message` to answer with a JSON-RPC error.
 */
export type RpcHandlers = Record<string, (params: unknown[], url: string) => unknown>;

interface RpcRequest {
  id: number;
  method: string;
  params?: unknown[];
}

/** Stub `fetch` with the given handlers and return the live log of calls made. */
export function stubRpc(handlers: RpcHandlers): RpcCall[] {
  const calls: RpcCall[] = [];

  function answer(request: RpcRequest, url: string) {
    const params = request.params ?? [];
    calls.push({ url, method: request.method, params });
    const handler = handlers[request.method];
    if (!handler) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `rpc stub: no handler for ${request.method}` },
      };
    }
    try {
      return { jsonrpc: "2.0", id: request.id, result: handler(params, url) };
    } catch (error) {
      return { jsonrpc: "2.0", id: request.id, error };
    }
  }

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = endpoint(
        typeof input === "string" || input instanceof URL ? String(input) : input.url,
      );
      const body = JSON.parse(String(init?.body)) as RpcRequest | RpcRequest[];
      const payload = Array.isArray(body)
        ? body.map((request) => answer(request, url))
        : answer(body, url);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );

  return calls;
}

/** The URL a `fetch` call was made with, normalised like `endpoint`. */
function urlOf(input: string | URL | Request): string {
  return endpoint(typeof input === "string" || input instanceof URL ? String(input) : input.url);
}

/**
 * Cut endpoints off at the network: a request to a URL in the returned `down`
 * set fails the way one to an unreachable host does, before it reaches the
 * `fetch` that was stubbed before this call (`stubRpc`'s, usually). The set is
 * live and holds URLs as `endpoint` gives them, so a test can take an endpoint
 * down or bring it back between calls. `attempts` lists the endpoint of every
 * request made, reached or not.
 */
export function cutOff(urls: Iterable<string> = []): { down: Set<string>; attempts: string[] } {
  const down = new Set([...urls].map(endpoint));
  const attempts: string[] = [];
  const reach = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input);
    attempts.push(url);
    if (down.has(url)) {
      throw new TypeError("fetch failed");
    }
    return reach(input, init);
  });
  return { down, attempts };
}
