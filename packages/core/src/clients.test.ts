import { type BaseError, createPublicClient, HttpRequestError, TimeoutError } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineChain, fuji, rpcEndpoints } from "./chains.js";
import { getPublicClient, getRpcTransport, toViemChain } from "./clients.js";
import * as entry from "./index.js";
import { RpcEndpointsError } from "./rpc-failover.js";
import { endpoint, type RpcHandlers, stubRpc } from "./testing/rpc.js";

/** A freshly launched L1, defined the way the devnet templates do: one RPC URL. */
const freshL1 = defineChain({
  id: 1001,
  name: "Fresh L1",
  rpcUrl: "http://127.0.0.1:9650/ext/bc/fresh/rpc",
  explorerUrl: "",
  nativeCurrency: { name: "Fresh", symbol: "FRSH", decimals: 18 },
  testnet: true,
});

const [FUJI_PRIMARY = "", FUJI_FALLBACK = ""] = rpcEndpoints(fuji).map(endpoint);
const L1 = endpoint(freshL1.rpcUrl);

/**
 * How an endpoint behaves: it answers through the RPC handlers, cannot be
 * reached at all, answers every request with this HTTP status, never answers
 * (until the request is aborted), or answers every request with this HTTP
 * status and this JSON-RPC error.
 */
type Behaviour =
  | "answers"
  | "unreachable"
  | "hangs"
  | number
  | { status: number; error: { code: number; message: string } };

/**
 * Stub `fetch` so each endpoint behaves as `behaviour` says (default: it
 * answers). `attempts` lists the endpoint of every request made, in order.
 */
function stubEndpoints(behaviour: Record<string, Behaviour>, handlers: RpcHandlers = {}) {
  const calls = stubRpc(handlers);
  const reach = globalThis.fetch;
  const attempts: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = endpoint(input instanceof Request ? input.url : String(input));
    attempts.push(url);
    const how = behaviour[url] ?? "answers";
    if (how === "unreachable") {
      throw new TypeError("fetch failed");
    }
    if (how === "hangs") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("This operation was aborted", "AbortError")),
          { once: true },
        );
      });
    }
    if (typeof how === "number") {
      return new Response("Service Unavailable", { status: how });
    }
    if (typeof how === "object") {
      return Response.json({ jsonrpc: "2.0", id: 1, error: how.error }, { status: how.status });
    }
    return reach(input, init);
  });
  return { calls, attempts };
}

/** What a call rejected with, without letting the rejection go unhandled. */
function outcome(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => null,
    (error: unknown) => error,
  );
}

/** A JSON-RPC error answer, as a handler throws it. */
function answer(code: number, message: string) {
  return () => {
    throw { code, message };
  };
}

/** A raw transaction to broadcast. Any bytes do: the stubbed nodes never decode it. */
const RAW_TX = `0x02f86a82a869${"00".repeat(40)}` as const;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("toViemChain", () => {
  it("maps an AvaChain into the viem Chain shape", () => {
    const chain = toViemChain(fuji);
    expect(chain.id).toBe(fuji.id);
    expect(chain.name).toBe(fuji.name);
    expect(chain.rpcUrls.default.http[0]).toBe(fuji.rpcUrl);
    expect(chain.blockExplorers?.default.url).toBe(fuji.explorerUrl);
    expect(chain.testnet).toBe(true);
  });

  // viem's addChain hands these to the wallet, which defaults to the first.
  it("lists every RPC URL of the chain, primary first", () => {
    expect(toViemChain(fuji).rpcUrls.default.http).toEqual(rpcEndpoints(fuji));
    expect(toViemChain(fuji).rpcUrls.default.http).toHaveLength(2);
    expect(toViemChain(freshL1).rpcUrls.default.http).toEqual([freshL1.rpcUrl]);
  });

  // viem's addChain turns blockExplorers into blockExplorerUrls, so an entry
  // with an empty URL would reach the wallet as [""] and be rejected.
  it("has no blockExplorers entry for a chain without an explorer", () => {
    const chain = toViemChain(freshL1);
    expect(chain.blockExplorers).toBeUndefined();
    expect(chain.rpcUrls.default.http[0]).toBe(freshL1.rpcUrl);
  });
});

describe("getPublicClient", () => {
  it("reads from the chain's next RPC URL when the first cannot be reached", async () => {
    const { attempts } = stubEndpoints(
      { [FUJI_PRIMARY]: "unreachable" },
      { eth_blockNumber: () => "0x2a" },
    );

    expect(await getPublicClient(fuji).getBlockNumber()).toBe(42n);
    expect(attempts).toEqual([FUJI_PRIMARY, FUJI_FALLBACK]);
  });

  // The first URL gets no retries of its own before the next one is asked.
  it("moves on at once when the first URL answers with an HTTP error", async () => {
    const { attempts } = stubEndpoints({ [FUJI_PRIMARY]: 503 }, { eth_blockNumber: () => "0x2a" });

    expect(await getPublicClient(fuji).getBlockNumber()).toBe(42n);
    expect(attempts).toEqual([FUJI_PRIMARY, FUJI_FALLBACK]);
  });

  it("waits ten seconds for a URL that does not answer, then asks the next", async () => {
    vi.useFakeTimers();
    const { attempts } = stubEndpoints(
      { [FUJI_PRIMARY]: "hangs" },
      { eth_blockNumber: () => "0x2a" },
    );

    const read = getPublicClient(fuji).getBlockNumber();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(attempts).toEqual([FUJI_PRIMARY]);
    await vi.advanceTimersByTimeAsync(1);

    expect(await read).toBe(42n);
    expect(attempts).toEqual([FUJI_PRIMARY, FUJI_FALLBACK]);
  });

  it("tries the whole list three more times with backoff, then rejects naming every URL", async () => {
    vi.useFakeTimers();
    const { attempts } = stubEndpoints({ [FUJI_PRIMARY]: 503, [FUJI_FALLBACK]: 503 });

    const read = outcome(getPublicClient(fuji).getBlockNumber());
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toHaveLength(2);
    // 150 ms, then 300, then 600 between the passes over the list.
    await vi.advanceTimersByTimeAsync(149);
    expect(attempts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(300);
    expect(attempts).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(600);
    const error = await read;

    expect(attempts).toEqual(Array.from({ length: 4 }, () => [FUJI_PRIMARY, FUJI_FALLBACK]).flat());
    expect(error).toBeInstanceOf(RpcEndpointsError);
    expect((error as RpcEndpointsError).shortMessage).toBe(
      "Every RPC endpoint of Avalanche Fuji failed: https://api.avax-test.network answered " +
        "HTTP 503; https://avalanche-fuji-c-chain-rpc.publicnode.com answered HTTP 503.",
    );
    // viem's own error for the last URL stays underneath, where code that
    // walks an error's causes (as viem's actions do) still finds it.
    expect((error as RpcEndpointsError).cause).toBeInstanceOf(HttpRequestError);
    expect((error as RpcEndpointsError).cause).toMatchObject({ status: 503, url: FUJI_FALLBACK });
    expect((error as BaseError).walk((cause) => cause instanceof HttpRequestError)).toBe(
      (error as RpcEndpointsError).cause,
    );
    expect(
      (error as RpcEndpointsError).failures.map(({ url, error }) => [
        url,
        (error as HttpRequestError).status,
      ]),
    ).toEqual(rpcEndpoints(fuji).map((url) => [url, 503]));
  });

  // A revert is the chain's answer, the same on every node: asking elsewhere
  // or again would only repeat it.
  it("neither retries nor asks elsewhere when the node refuses the call itself", async () => {
    const { attempts } = stubEndpoints(
      {},
      {
        eth_call: () => {
          throw { code: 3, message: "execution reverted: sold out", data: "0x" };
        },
      },
    );

    await expect(
      getPublicClient(fuji).call({ to: "0x0000000000000000000000000000000000000001", data: "0x" }),
    ).rejects.toThrow(/sold out/);
    expect(attempts).toEqual([FUJI_PRIMARY]);
  });

  it("keeps a chain with one RPC URL on viem's single-endpoint behaviour", async () => {
    vi.useFakeTimers();
    const { attempts } = stubEndpoints({ [L1]: 503 });

    const read = outcome(getPublicClient(freshL1).getBlockNumber());
    await vi.advanceTimersByTimeAsync(1_050);

    // viem's own error, as from a plain http transport.
    const error = await read;
    expect(error).toBeInstanceOf(HttpRequestError);
    expect(error).not.toBeInstanceOf(RpcEndpointsError);
    expect(error).toMatchObject({ status: 503 });
    // The first try and three retries, all at the only endpoint there is.
    expect(attempts).toEqual([L1, L1, L1, L1]);
  });

  // viem's ranking pings every endpoint every few seconds for as long as the
  // client lives, and AvaKit makes a client per call.
  it("sends nothing of its own accord: the endpoints are not ranked in the background", async () => {
    vi.useFakeTimers();
    const { attempts } = stubEndpoints({});

    getPublicClient(fuji);
    getPublicClient(fuji);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(attempts).toEqual([]);
  });

  it("is a fallback over the chain's endpoints, with no retries inside it and a limit on every request", () => {
    const { transport } = getPublicClient(fuji);
    expect(transport).toMatchObject({ type: "fallback", retryCount: 3, retryDelay: 150 });
    const inner = (
      transport as unknown as {
        transports: { config: { retryCount: number; timeout: number }; value: { url: string } }[];
      }
    ).transports;
    expect(inner.map((each) => each.value.url)).toEqual(rpcEndpoints(fuji));
    for (const each of inner) {
      expect(each.config).toMatchObject({ retryCount: 0, timeout: 10_000 });
    }

    expect(getPublicClient(freshL1).transport).toMatchObject({
      type: "http",
      url: freshL1.rpcUrl,
      retryCount: 3,
      retryDelay: 150,
      timeout: 10_000,
    });
  });
});

// The next URL is asked only when the one before it failed the request. An
// answer about the request itself is the chain's answer: the same on every
// node, and not something to hand to a second one.
describe("when a request moves on to the next URL", () => {
  it.each([
    [-32603, "internal error"],
    [-32005, "limit exceeded"],
    [-32002, "resource unavailable"],
    [-32001, "resource not found"],
    [-32601, "the method eth_blockNumber does not exist/is not available"],
    [-32004, "method not supported"],
    [429, "Too Many Requests"],
    [-32000, "header not found"],
    [-32000, "missing trie node 5c2f (path ) state is not available"],
    [-32000, "request timed out"],
    [-32000, "server is overloaded"],
    [-32000, "rate limit exceeded"],
  ])("moves on when the node answers %i %s, which says it cannot serve the request now", async (code, message) => {
    const { attempts } = stubEndpoints(
      {},
      {
        eth_blockNumber: (_params, url) => {
          if (url === FUJI_PRIMARY) throw { code, message };
          return "0x2a";
        },
      },
    );

    expect(await getPublicClient(fuji).getBlockNumber()).toBe(42n);
    expect(attempts).toEqual([FUJI_PRIMARY, FUJI_FALLBACK]);
  });

  it("moves on when the endpoint turns the request away with an HTTP error, whatever the body says", async () => {
    const { attempts } = stubEndpoints(
      { [FUJI_PRIMARY]: { status: 429, error: { code: -32000, message: "slow down" } } },
      { eth_blockNumber: () => "0x2a" },
    );

    expect(await getPublicClient(fuji).getBlockNumber()).toBe(42n);
    expect(attempts).toEqual([FUJI_PRIMARY, FUJI_FALLBACK]);
  });

  it.each([
    "nonce too low",
    "replacement transaction underpriced",
    "already known",
    "insufficient funds for gas * price + value: have 0 want 21000",
  ])("does not hand a raw transaction the node refused (%s) to the next URL", async (message) => {
    const { attempts } = stubEndpoints({}, { eth_sendRawTransaction: answer(-32000, message) });

    const error = await outcome(
      getPublicClient(fuji).sendRawTransaction({ serializedTransaction: RAW_TX }),
    );

    expect((error as Error).message).toContain(message);
    expect(error).not.toBeInstanceOf(RpcEndpointsError);
    expect(attempts).toEqual([FUJI_PRIMARY]);
  });

  // Seen through an HTTP error status too: the node's answer decides.
  it("does not hand on a refusal that came with an HTTP 400", async () => {
    const { attempts } = stubEndpoints({
      [FUJI_PRIMARY]: { status: 400, error: { code: -32000, message: "nonce too low" } },
    });

    const error = await outcome(
      getPublicClient(fuji).sendRawTransaction({ serializedTransaction: RAW_TX }),
    );

    expect((error as Error).message).toContain("nonce too low");
    expect(attempts).toEqual([FUJI_PRIMARY]);
  });

  it("reports the first node's answer when it cannot pay for a call, without a second opinion", async () => {
    const { attempts } = stubEndpoints(
      {},
      { eth_estimateGas: answer(-32000, "insufficient funds for gas * price + value") },
    );

    await expect(
      getPublicClient(fuji).estimateGas({
        account: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        value: 1n,
      }),
    ).rejects.toThrow(/insufficient funds/);
    expect(attempts).toEqual([FUJI_PRIMARY]);
  });

  it("reports a bad parameter as the first node gave it", async () => {
    const { attempts } = stubEndpoints(
      {},
      { eth_getBalance: answer(-32602, "invalid argument 0: hex string has odd length") },
    );

    await expect(
      getPublicClient(fuji).getBalance({ address: "0x0000000000000000000000000000000000000001" }),
    ).rejects.toThrow(/odd length/);
    expect(attempts).toEqual([FUJI_PRIMARY]);
  });
});

describe("a call that fails at every URL", () => {
  it("names each URL by its origin, with how it failed", async () => {
    vi.useFakeTimers();
    const { attempts } = stubEndpoints({ [FUJI_PRIMARY]: "unreachable", [FUJI_FALLBACK]: "hangs" });

    const read = outcome(getPublicClient(fuji).getBlockNumber());
    // Four passes, each waiting ten seconds on the second URL, and the
    // backoff between them.
    await vi.advanceTimersByTimeAsync(4 * 10_000 + 150 + 300 + 600);
    const error = await read;

    expect(attempts).toHaveLength(8);
    expect(error).toBeInstanceOf(RpcEndpointsError);
    expect((error as RpcEndpointsError).shortMessage).toBe(
      "Every RPC endpoint of Avalanche Fuji failed: https://api.avax-test.network could not be " +
        "reached; https://avalanche-fuji-c-chain-rpc.publicnode.com did not answer in time.",
    );
    expect((error as RpcEndpointsError).cause).toBeInstanceOf(TimeoutError);
  });

  it("says what each node answered when every one is behind", async () => {
    const { attempts } = stubEndpoints({}, { eth_blockNumber: answer(-32000, "header not found") });

    const error = await outcome(getPublicClient(fuji).getBlockNumber());

    expect((error as RpcEndpointsError).shortMessage).toBe(
      'Every RPC endpoint of Avalanche Fuji failed: https://api.avax-test.network answered "header ' +
        'not found"; https://avalanche-fuji-c-chain-rpc.publicnode.com answered "header not found".',
    );
    // What the node said is still where viem keeps it.
    expect((error as RpcEndpointsError).details).toBe("header not found");
    expect(attempts).toEqual([FUJI_PRIMARY, FUJI_FALLBACK]);
  });

  // An RPC URL can hold a password or an API key, and the message reaches
  // screens and logs.
  it("never shows the user part, path or query of a URL", async () => {
    vi.useFakeTimers();
    const keyed = defineChain({
      ...fuji,
      name: "Keyed Fuji",
      rpcUrls: [fuji.rpcUrl, "https://user:s3cret@rpc.example.com/v3/APIKEY123?key=QUERYKEY"],
    });
    const fetched = "https://rpc.example.com/v3/APIKEY123?key=QUERYKEY";
    stubEndpoints({ [FUJI_PRIMARY]: "unreachable", [fetched]: 503 });

    const read = outcome(getPublicClient(keyed).getBlockNumber());
    await vi.advanceTimersByTimeAsync(1_050);
    const error = (await read) as RpcEndpointsError;

    expect(error.shortMessage).toBe(
      "Every RPC endpoint of Keyed Fuji failed: https://api.avax-test.network could not be " +
        "reached; https://rpc.example.com answered HTTP 503.",
    );
    for (const secret of ["user", "s3cret", "APIKEY123", "QUERYKEY", "/v3/"]) {
      expect(error.message).not.toContain(secret);
    }
  });

  // viem serves identical requests in flight (a chain id, a receipt) with one
  // request, and a client's calls keep that.
  it("is one request, and one error, for two identical calls in flight", async () => {
    vi.useFakeTimers();
    const { attempts } = stubEndpoints({ [FUJI_PRIMARY]: 503, [FUJI_FALLBACK]: 503 });
    const client = getPublicClient(fuji);

    const both = Promise.all([outcome(client.getChainId()), outcome(client.getChainId())]);
    await vi.advanceTimersByTimeAsync(1_050);
    const [first, second] = await both;

    expect(first).toBeInstanceOf(RpcEndpointsError);
    expect(second).toBe(first);
    expect(attempts).toHaveLength(8);
  });

  it("rejects with the abort when its caller gives up, and asks no further", async () => {
    vi.useFakeTimers();
    const { attempts } = stubEndpoints({ [FUJI_PRIMARY]: "hangs" });
    const controller = new AbortController();

    const read = outcome(
      getPublicClient(fuji).request({ method: "eth_blockNumber" }, { signal: controller.signal }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    const error = await read;

    expect(error).not.toBeInstanceOf(RpcEndpointsError);
    expect((error as Error).name).toBe("AbortError");
    expect(attempts).toEqual([FUJI_PRIMARY]);
  });

  // viem's fallback reports every attempt to one listener; AvaKit's keeps that.
  it("still reports every attempt to the transport's onResponse listener", async () => {
    stubEndpoints({ [FUJI_PRIMARY]: "unreachable" }, { eth_blockNumber: () => "0x2a" });
    const client = getPublicClient(fuji);
    const seen: [string, unknown][] = [];
    (
      client.transport as unknown as {
        onResponse: (
          fn: (response: { status: string; transport: { value?: { url?: string } } }) => void,
        ) => void;
      }
    ).onResponse((response) => seen.push([response.status, response.transport.value?.url]));

    await client.getBlockNumber();

    expect(seen).toEqual([
      ["error", fuji.rpcUrl],
      ["success", rpcEndpoints(fuji)[1]],
    ]);
  });
});

describe("getRpcTransport", () => {
  it("gives a viem client of your own the same endpoints, in the same order", async () => {
    const { attempts } = stubEndpoints(
      { [FUJI_PRIMARY]: "unreachable" },
      { eth_blockNumber: () => "0x2a" },
    );
    const client = createPublicClient({
      chain: toViemChain(fuji),
      transport: getRpcTransport(fuji),
    });

    expect(await client.getBlockNumber()).toBe(42n);
    expect(attempts).toEqual([FUJI_PRIMARY, FUJI_FALLBACK]);
  });

  it("is exported from the package entry with rpcEndpoints and RpcEndpointsError, and the internals are not", () => {
    expect(entry.getRpcTransport).toBe(getRpcTransport);
    expect(entry.rpcEndpoints).toBe(rpcEndpoints);
    expect(entry.RpcEndpointsError).toBe(RpcEndpointsError);
    for (const internal of ["transportFor", "stopsAtEndpoint", "shownEndpoint"]) {
      expect(internal in entry).toBe(false);
    }
  });
});
