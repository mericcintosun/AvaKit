import { createPublicClient, HttpRequestError } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineChain, fuji, rpcEndpoints } from "./chains.js";
import { getPublicClient, getRpcTransport, toViemChain } from "./clients.js";
import * as entry from "./index.js";
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
 * reached at all, answers every request with this HTTP status, or never
 * answers (until the request is aborted).
 */
type Behaviour = "answers" | "unreachable" | "hangs" | number;

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
    return reach(input, init);
  });
  return { calls, attempts };
}

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

  it("tries the whole list three more times with backoff, then rejects with what the last URL said", async () => {
    vi.useFakeTimers();
    const { attempts } = stubEndpoints({ [FUJI_PRIMARY]: 503, [FUJI_FALLBACK]: 503 });

    const read = getPublicClient(fuji)
      .getBlockNumber()
      .then(
        () => null,
        (error: unknown) => error,
      );
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
    expect(error).toBeInstanceOf(HttpRequestError);
    expect(error).toMatchObject({ status: 503, url: FUJI_FALLBACK });
    expect((error as Error).message).toContain("HTTP request failed.");
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

    const read = getPublicClient(freshL1)
      .getBlockNumber()
      .then(
        () => null,
        (error: unknown) => error,
      );
    await vi.advanceTimersByTimeAsync(1_050);

    expect(await read).toMatchObject({ status: 503 });
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

  it("is exported from the package entry with rpcEndpoints, and the internal builder is not", () => {
    expect(entry.getRpcTransport).toBe(getRpcTransport);
    expect(entry.rpcEndpoints).toBe(rpcEndpoints);
    expect("transportFor" in entry).toBe(false);
  });
});
