"use client";

/**
 * Indexed chain-data hooks backed by the AvaCloud / Glacier Data API — token
 * balances, NFT holdings, and transaction history without running an indexer.
 *
 * Each hook defaults to the connected account and active chain, works keyless,
 * and uses `dataApiKey` from <AvaKitProvider> when provided.
 *
 * The Data API answers one page at a time. Every hook loads the first page and
 * reports `hasMore`; call `fetchMore()` to append the next page, and pass
 * `{ pageSize }` to choose how many items a page holds.
 */

import {
  type DataApiOptions,
  type DataTransaction,
  type Erc20BalancesResponse,
  type Erc20TokenBalance,
  type Erc721BalancesResponse,
  type Erc721TokenBalance,
  listErc20Balances,
  listNfts,
  listTransactions,
  type NativeTokenBalance,
  type TransactionsResponse,
} from "@avakit/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { useAvaKit } from "./provider.js";

/** Options accepted by the data hooks. */
export interface DataHookOptions {
  /** Items per page. Omit it for the Data API's default; the API caps it at 100. */
  pageSize?: number;
}

/** A Data API list response: one page of items plus the cursor for the next. */
interface PagedResponse {
  nextPageToken?: string;
}

type FetchPage<TResponse> = (
  address: Address,
  chainId: number,
  options: DataApiOptions,
) => Promise<TResponse>;

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * Shared engine of the three hooks: loads the first page for the target address
 * and chain, and appends further pages on demand. `fetchPage` and `itemsOf`
 * must be stable (module-level) functions.
 */
function usePagedList<TResponse extends PagedResponse, TItem>(
  address: Address | undefined,
  options: DataHookOptions | undefined,
  fetchPage: FetchPage<TResponse>,
  itemsOf: (response: TResponse) => TItem[] | undefined,
) {
  const { chain, address: connected, dataApiKey: apiKey } = useAvaKit();
  const target = address ?? connected;
  const chainId = chain.id;
  const pageSize = options?.pageSize;

  const [items, setItems] = useState<TItem[]>([]);
  const [firstPage, setFirstPage] = useState<TResponse | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Counts list restarts. A response that belongs to an older list (another
  // address or chain, or a refetch that started later) is dropped instead of
  // overwriting, or being appended to, the current one.
  const generation = useRef(0);
  // The generation a "load more" request is running for, so a double click does
  // not append the same page twice.
  const loadingMoreFor = useRef<number | null>(null);

  const refetch = useCallback(async () => {
    generation.current += 1;
    const current = generation.current;
    setNextPageToken(null);
    setIsFetchingMore(false);
    if (!target) {
      setItems([]);
      setFirstPage(null);
      // A request for the previous target may still be in flight; its result is
      // dropped, so nothing else would clear the flag.
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchPage(target, chainId, { apiKey, pageSize });
      if (current !== generation.current) return;
      setFirstPage(res);
      setItems(itemsOf(res) ?? []);
      setNextPageToken(res.nextPageToken ?? null);
    } catch (e) {
      if (current !== generation.current) return;
      setError(toError(e));
    } finally {
      if (current === generation.current) {
        setIsLoading(false);
      }
    }
  }, [target, chainId, apiKey, pageSize, fetchPage, itemsOf]);

  const fetchMore = useCallback(async () => {
    const current = generation.current;
    if (!target || !nextPageToken || loadingMoreFor.current === current) {
      return;
    }
    loadingMoreFor.current = current;
    setIsFetchingMore(true);
    setError(null);
    try {
      const res = await fetchPage(target, chainId, {
        apiKey,
        pageSize,
        pageToken: nextPageToken,
      });
      if (current !== generation.current) return;
      setItems((previous) => [...previous, ...(itemsOf(res) ?? [])]);
      setNextPageToken(res.nextPageToken ?? null);
    } catch (e) {
      if (current !== generation.current) return;
      setError(toError(e));
    } finally {
      if (loadingMoreFor.current === current) {
        loadingMoreFor.current = null;
      }
      if (current === generation.current) {
        setIsFetchingMore(false);
      }
    }
  }, [target, chainId, apiKey, pageSize, nextPageToken, fetchPage, itemsOf]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    items,
    firstPage,
    /** The fields every data hook returns next to its own list. */
    state: {
      isLoading,
      error,
      refetch,
      /** True while the Data API has further pages for this list. */
      hasMore: nextPageToken !== null,
      /** Load the next page and append it. Does nothing when there is none. */
      fetchMore,
      /** True while `fetchMore` is loading (`isLoading` covers the first page only). */
      isFetchingMore,
      /** The Data API cursor for the next page, or null on the last page. */
      nextPageToken,
    },
  };
}

const erc20Items = (res: Erc20BalancesResponse) => res.erc20TokenBalances;
const erc721Items = (res: Erc721BalancesResponse) => res.erc721TokenBalances;
const transactionItems = (res: TransactionsResponse) => res.transactions;

/**
 * Native + ERC-20 balances for an address (defaults to the connected account).
 * Returns the first page; use `hasMore` / `fetchMore()` for the rest.
 */
export function useTokenBalances(address?: Address, options?: DataHookOptions) {
  const { items, firstPage, state } = usePagedList<Erc20BalancesResponse, Erc20TokenBalance>(
    address,
    options,
    listErc20Balances,
    erc20Items,
  );
  const native: NativeTokenBalance | null = firstPage?.nativeTokenBalance ?? null;
  return { native, tokens: items, ...state };
}

/**
 * ERC-721 (NFT) holdings for an address (defaults to the connected account).
 * Returns the first page; use `hasMore` / `fetchMore()` for the rest.
 */
export function useNfts(address?: Address, options?: DataHookOptions) {
  const { items, state } = usePagedList<Erc721BalancesResponse, Erc721TokenBalance>(
    address,
    options,
    listNfts,
    erc721Items,
  );
  return { nfts: items, ...state };
}

/**
 * Recent transactions for an address, newest first (defaults to the connected
 * account). Returns the first page; use `hasMore` / `fetchMore()` for older ones.
 */
export function useTxHistory(address?: Address, options?: DataHookOptions) {
  const { items, state } = usePagedList<TransactionsResponse, DataTransaction>(
    address,
    options,
    listTransactions,
    transactionItems,
  );
  return { transactions: items, ...state };
}
