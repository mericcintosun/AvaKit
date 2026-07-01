import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DATA_API_BASE_URL,
  DataApiError,
  getNativeBalance,
  listErc20Balances,
  listNfts,
  listTransactions,
} from "./data-api.js";

const ADDR = "0xd305607510e0db2c95807173c7a05bea53c1ed36" as const;

function mockFetch(payload: unknown, init?: { ok?: boolean; status?: number; body?: string }) {
  const response = {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: "err",
    json: async () => payload,
    text: async () => init?.body ?? "",
  } as Response;
  const spy = vi.fn(
    (_url: string | URL, _init?: RequestInit): Promise<Response> => Promise.resolve(response),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function requestedUrl(spy: ReturnType<typeof mockFetch>, i = 0): URL {
  const call = spy.mock.calls.at(i);
  expect(call).toBeDefined();
  return new URL(call?.[0] ?? "");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("data-api", () => {
  it("builds the native-balance URL for the given chain and address", async () => {
    const spy = mockFetch({ nativeTokenBalance: { balance: "1" } });
    await getNativeBalance(ADDR, 43113);
    const url = requestedUrl(spy);
    expect(url.origin + url.pathname).toBe(
      `${DATA_API_BASE_URL}/chains/43113/addresses/${ADDR}/balances:getNative`,
    );
  });

  it("targets the erc20, erc721, and transactions endpoints", async () => {
    const spy = mockFetch({});
    await listErc20Balances(ADDR, 43114);
    await listNfts(ADDR, 43114);
    await listTransactions(ADDR, 43114);
    expect(requestedUrl(spy, 0).pathname).toMatch(/balances:listErc20$/);
    expect(requestedUrl(spy, 1).pathname).toMatch(/balances:listErc721$/);
    expect(requestedUrl(spy, 2).pathname).toMatch(/\/transactions$/);
  });

  it("passes the api key header and pagination params", async () => {
    const spy = mockFetch({});
    await listTransactions(ADDR, 43113, { apiKey: "secret", pageSize: 25, pageToken: "abc" });
    const url = requestedUrl(spy);
    expect(url.searchParams.get("pageSize")).toBe("25");
    expect(url.searchParams.get("pageToken")).toBe("abc");
    const headers = spy.mock.calls.at(0)?.[1]?.headers as Record<string, string> | undefined;
    expect(headers).toMatchObject({ "x-glacier-api-key": "secret" });
  });

  it("throws a DataApiError with the status on a non-ok response", async () => {
    mockFetch(null, { ok: false, status: 429, body: "rate limited" });
    await expect(getNativeBalance(ADDR, 43113)).rejects.toBeInstanceOf(DataApiError);
    await expect(getNativeBalance(ADDR, 43113)).rejects.toMatchObject({ status: 429 });
  });
});
