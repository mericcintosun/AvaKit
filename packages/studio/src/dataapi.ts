/**
 * On-chain data for any address on a public Avalanche network (Fuji / C-Chain),
 * via the AvaCloud Data API — reusing @avakit/core's wrappers. No indexer.
 * (The Data API doesn't index local devnets, so this is for public chains.)
 */

import { getNativeBalance, listErc20Balances, listNfts, listTransactions } from "@avakit/core";

export interface DataSummary {
  native: { symbol: string; balance: string; decimals: number } | null;
  tokens: { address: string; symbol: string; name: string; balance: string; decimals: number }[];
  nfts: { address: string; name: string; symbol: string; tokenId: string }[];
  transactions: {
    txHash: string;
    from: string;
    to: string;
    timestamp: number;
    method: string | null;
    status: string;
  }[];
}

export async function getAddressData(address: string, chainId: number): Promise<DataSummary> {
  const addr = address as `0x${string}`;
  // Each call fails independently so one rate-limit doesn't blank the whole view.
  const [nb, erc20, nftRes, txRes] = await Promise.all([
    getNativeBalance(addr, chainId).catch(() => null),
    listErc20Balances(addr, chainId, { pageSize: 25 }).catch(() => null),
    listNfts(addr, chainId, { pageSize: 24 }).catch(() => null),
    listTransactions(addr, chainId, { pageSize: 15 }).catch(() => null),
  ]);

  return {
    native: nb
      ? {
          symbol: nb.nativeTokenBalance.symbol,
          balance: nb.nativeTokenBalance.balance,
          decimals: nb.nativeTokenBalance.decimals,
        }
      : null,
    tokens: (erc20?.erc20TokenBalances ?? [])
      .filter((t) => t.balance !== "0")
      .map((t) => ({
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        balance: t.balance,
        decimals: t.decimals,
      })),
    nfts: (nftRes?.erc721TokenBalances ?? []).map((n) => ({
      address: n.address,
      name: n.name,
      symbol: n.symbol,
      tokenId: n.tokenId,
    })),
    transactions: (txRes?.transactions ?? []).map((tx) => ({
      txHash: tx.nativeTransaction.txHash,
      from: tx.nativeTransaction.from.address,
      to: tx.nativeTransaction.to?.address ?? "",
      timestamp: tx.nativeTransaction.blockTimestamp,
      method: tx.nativeTransaction.method?.methodName ?? null,
      status: tx.nativeTransaction.txStatus,
    })),
  };
}
