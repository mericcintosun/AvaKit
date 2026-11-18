import {
  type DataApiOptions,
  type Erc20BalancesResponse,
  type Erc20TokenBalance,
  type Erc721BalancesResponse,
  listErc20Balances,
  listNfts,
  listTransactions,
  type NativeTokenBalance,
  type TransactionsResponse,
} from "@avakit/core";
import { fuji } from "@avakit/core/chains";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNfts, useTokenBalances, useTxHistory } from "./data-hooks.js";
import { AvaKitProvider } from "./provider.js";

// The Data API client is replaced, so no request ever leaves the test.
vi.mock("@avakit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@avakit/core")>();
  return {
    ...actual,
    listErc20Balances: vi.fn(),
    listNfts: vi.fn(),
    listTransactions: vi.fn(),
  };
});

const HOLDER = "0x000000000000000000000000000000000000dEaD" as Address;
const OTHER_HOLDER = "0x00000000000000000000000000000000000000A1" as Address;

const native: NativeTokenBalance = {
  chainId: "43113",
  name: "Avalanche",
  symbol: "AVAX",
  decimals: 18,
  balance: "1000",
};

function token(symbol: string): Erc20TokenBalance {
  return {
    ercType: "ERC-20",
    chainId: "43113",
    address: "0x00000000000000000000000000000000000000b0",
    name: symbol,
    symbol,
    decimals: 18,
    balance: "1",
  };
}

/** A token list served two per page: [A, B] then [C]. */
function serveTokensInTwoPages() {
  vi.mocked(listErc20Balances).mockImplementation(
    async (_address, _chain, options?: DataApiOptions): Promise<Erc20BalancesResponse> =>
      options?.pageToken === "page-2"
        ? { nativeTokenBalance: native, erc20TokenBalances: [token("C")] }
        : {
            nativeTokenBalance: native,
            erc20TokenBalances: [token("A"), token("B")],
            nextPageToken: "page-2",
          },
  );
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AvaKitProvider chains={[fuji]} adapters={[]} dataApiKey="test-key">
      {children}
    </AvaKitProvider>
  );
}

const symbols = (tokens: Erc20TokenBalance[]) => tokens.map((t) => t.symbol);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useTokenBalances", () => {
  it("loads the first page and reports that more is available", async () => {
    serveTokensInTwoPages();
    const { result } = renderHook(() => useTokenBalances(HOLDER, { pageSize: 2 }), { wrapper });

    await waitFor(() => {
      expect(symbols(result.current.tokens)).toEqual(["A", "B"]);
    });
    expect(result.current.native).toEqual(native);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(true);
    expect(result.current.nextPageToken).toBe("page-2");
    expect(listErc20Balances).toHaveBeenCalledWith(HOLDER, fuji.id, {
      apiKey: "test-key",
      pageSize: 2,
    });
  });

  // The hook used to stop here: nextPageToken was thrown away, so a holder with
  // more tokens than one page saw a silently truncated list.
  it("fetchMore appends the next page and clears hasMore on the last one", async () => {
    serveTokensInTwoPages();
    const { result } = renderHook(() => useTokenBalances(HOLDER, { pageSize: 2 }), { wrapper });
    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });

    await act(async () => {
      await result.current.fetchMore();
    });

    expect(symbols(result.current.tokens)).toEqual(["A", "B", "C"]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.nextPageToken).toBeNull();
    expect(result.current.isFetchingMore).toBe(false);
    expect(listErc20Balances).toHaveBeenLastCalledWith(HOLDER, fuji.id, {
      apiKey: "test-key",
      pageSize: 2,
      pageToken: "page-2",
    });

    // Nothing left to load: a further call asks the API for nothing.
    await act(async () => {
      await result.current.fetchMore();
    });
    expect(listErc20Balances).toHaveBeenCalledTimes(2);
  });

  it("requests a page once when fetchMore is called twice in a row", async () => {
    serveTokensInTwoPages();
    const { result } = renderHook(() => useTokenBalances(HOLDER), { wrapper });
    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });

    await act(async () => {
      await Promise.all([result.current.fetchMore(), result.current.fetchMore()]);
    });

    expect(symbols(result.current.tokens)).toEqual(["A", "B", "C"]);
    expect(listErc20Balances).toHaveBeenCalledTimes(2);
  });

  it("refetch starts again from the first page", async () => {
    serveTokensInTwoPages();
    const { result } = renderHook(() => useTokenBalances(HOLDER), { wrapper });
    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });
    await act(async () => {
      await result.current.fetchMore();
    });
    expect(result.current.tokens).toHaveLength(3);

    await act(async () => {
      await result.current.refetch();
    });

    expect(symbols(result.current.tokens)).toEqual(["A", "B"]);
    expect(result.current.hasMore).toBe(true);
  });

  it("keeps the loaded items and reports the error when a later page fails", async () => {
    vi.mocked(listErc20Balances).mockImplementation(async (_address, _chain, options) => {
      if (options?.pageToken) throw new Error("rate limited");
      return {
        nativeTokenBalance: native,
        erc20TokenBalances: [token("A")],
        nextPageToken: "page-2",
      };
    });
    const { result } = renderHook(() => useTokenBalances(HOLDER), { wrapper });
    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });

    await act(async () => {
      await result.current.fetchMore();
    });

    expect(result.current.error?.message).toBe("rate limited");
    expect(symbols(result.current.tokens)).toEqual(["A"]);
    // The cursor survives, so the page can be retried.
    expect(result.current.hasMore).toBe(true);
    expect(result.current.isFetchingMore).toBe(false);
  });

  it("drops a slower response that belongs to a previous address", async () => {
    let releaseFirst: (value: Erc20BalancesResponse) => void = () => {};
    vi.mocked(listErc20Balances).mockImplementation((address) =>
      address === HOLDER
        ? new Promise<Erc20BalancesResponse>((resolve) => {
            releaseFirst = resolve;
          })
        : Promise.resolve({ nativeTokenBalance: native, erc20TokenBalances: [token("NEW")] }),
    );
    const { result, rerender } = renderHook(({ holder }) => useTokenBalances(holder), {
      wrapper,
      initialProps: { holder: HOLDER },
    });

    rerender({ holder: OTHER_HOLDER });
    await waitFor(() => {
      expect(symbols(result.current.tokens)).toEqual(["NEW"]);
    });

    await act(async () => {
      releaseFirst({
        nativeTokenBalance: native,
        erc20TokenBalances: [token("STALE")],
        nextPageToken: "stale-page",
      });
    });

    expect(symbols(result.current.tokens)).toEqual(["NEW"]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it("stays empty, and asks for nothing, without an address", async () => {
    const { result } = renderHook(() => useTokenBalances(), { wrapper });

    expect(result.current.tokens).toEqual([]);
    expect(result.current.native).toBeNull();
    expect(result.current.hasMore).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(listErc20Balances).not.toHaveBeenCalled();
  });
});

describe("useNfts", () => {
  it("pages through the holdings", async () => {
    const nft = (tokenId: string) =>
      ({
        ercType: "ERC-721",
        chainId: "43113",
        address: "0x00000000000000000000000000000000000000c0",
        name: "Demo",
        symbol: "DEMO",
        tokenId,
        ownerAddress: HOLDER,
      }) as const;
    vi.mocked(listNfts).mockImplementation(
      async (_address, _chain, options): Promise<Erc721BalancesResponse> =>
        options?.pageToken === "next"
          ? { nativeTokenBalance: native, erc721TokenBalances: [nft("2")] }
          : { nativeTokenBalance: native, erc721TokenBalances: [nft("1")], nextPageToken: "next" },
    );
    const { result } = renderHook(() => useNfts(HOLDER, { pageSize: 1 }), { wrapper });
    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });
    expect(result.current.nfts.map((n) => n.tokenId)).toEqual(["1"]);

    await act(async () => {
      await result.current.fetchMore();
    });

    expect(result.current.nfts.map((n) => n.tokenId)).toEqual(["1", "2"]);
    expect(result.current.hasMore).toBe(false);
    expect(listNfts).toHaveBeenLastCalledWith(HOLDER, fuji.id, {
      apiKey: "test-key",
      pageSize: 1,
      pageToken: "next",
    });
  });
});

describe("useTxHistory", () => {
  it("pages back through older transactions", async () => {
    const tx = (txHash: string) =>
      ({
        nativeTransaction: { txHash },
      }) as unknown as TransactionsResponse["transactions"][number];
    vi.mocked(listTransactions).mockImplementation(
      async (_address, _chain, options): Promise<TransactionsResponse> =>
        options?.pageToken === "older"
          ? { transactions: [tx("0x02")] }
          : { transactions: [tx("0x01")], nextPageToken: "older" },
    );
    const { result } = renderHook(() => useTxHistory(HOLDER), { wrapper });
    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });

    await act(async () => {
      await result.current.fetchMore();
    });

    expect(result.current.transactions.map((t) => t.nativeTransaction.txHash)).toEqual([
      "0x01",
      "0x02",
    ]);
    expect(result.current.hasMore).toBe(false);
  });
});
