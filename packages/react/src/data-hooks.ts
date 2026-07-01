"use client";

/**
 * Indexed chain-data hooks backed by the AvaCloud / Glacier Data API — token
 * balances, NFT holdings, and transaction history without running an indexer.
 *
 * Each hook defaults to the connected account and active chain, works keyless,
 * and uses `dataApiKey` from <AvaKitProvider> when provided.
 */

import {
  type DataTransaction,
  type Erc20TokenBalance,
  type Erc721TokenBalance,
  listErc20Balances,
  listNfts,
  listTransactions,
  type NativeTokenBalance,
} from "@avakit/core";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { useAvaKit } from "./provider.js";

function useDataTarget(address?: Address) {
  const { chain, address: connected, dataApiKey } = useAvaKit();
  return { target: address ?? connected, chainId: chain.id, apiKey: dataApiKey };
}

/** Native + ERC-20 balances for an address (defaults to the connected account). */
export function useTokenBalances(address?: Address) {
  const { target, chainId, apiKey } = useDataTarget(address);
  const [native, setNative] = useState<NativeTokenBalance | null>(null);
  const [tokens, setTokens] = useState<Erc20TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!target) {
      setNative(null);
      setTokens([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await listErc20Balances(target, chainId, { apiKey });
      setNative(res.nativeTokenBalance ?? null);
      setTokens(res.erc20TokenBalances ?? []);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, [target, chainId, apiKey]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { native, tokens, isLoading, error, refetch };
}

/** ERC-721 (NFT) holdings for an address (defaults to the connected account). */
export function useNfts(address?: Address) {
  const { target, chainId, apiKey } = useDataTarget(address);
  const [nfts, setNfts] = useState<Erc721TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!target) {
      setNfts([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await listNfts(target, chainId, { apiKey });
      setNfts(res.erc721TokenBalances ?? []);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, [target, chainId, apiKey]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { nfts, isLoading, error, refetch };
}

/** Recent transactions for an address, newest first (defaults to the connected account). */
export function useTxHistory(address?: Address) {
  const { target, chainId, apiKey } = useDataTarget(address);
  const [transactions, setTransactions] = useState<DataTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!target) {
      setTransactions([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await listTransactions(target, chainId, { apiKey });
      setTransactions(res.transactions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, [target, chainId, apiKey]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { transactions, isLoading, error, refetch };
}
