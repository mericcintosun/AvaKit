/**
 * On-chain data for any address on a public Avalanche network (Fuji / C-Chain),
 * via the AvaCloud Data API — reusing @avakit/core's wrappers. No indexer.
 * (The Data API doesn't index local devnets, so this is for public chains.)
 */

import { getNativeBalance, listErc20Balances, listNfts, listTransactions } from "@avakit/core";

export type DataSection = "native" | "tokens" | "nfts" | "transactions";

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
  /**
   * The sections whose Data API call failed, with the reason. A section listed
   * here is UNKNOWN, not empty: its value above is only a placeholder, and
   * showing it as "0" or "none" would be a wrong answer.
   */
  errors: Partial<Record<DataSection, string>>;
}

export async function getAddressData(address: string, chainId: number): Promise<DataSummary> {
  const addr = address as `0x${string}`;
  const errors: DataSummary["errors"] = {};

  // Each section loads (and fails) on its own, so one rate-limit doesn't blank
  // the whole view — but a failure is recorded, never passed off as "empty".
  async function section<T>(name: DataSection, fallback: T, load: () => Promise<T>): Promise<T> {
    try {
      return await load();
    } catch (e) {
      errors[name] = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      return fallback;
    }
  }

  const [native, tokens, nfts, transactions] = await Promise.all([
    section<DataSummary["native"]>("native", null, async () => {
      const { nativeTokenBalance: b } = await getNativeBalance(addr, chainId);
      return { symbol: b.symbol, balance: b.balance, decimals: b.decimals };
    }),
    section<DataSummary["tokens"]>("tokens", [], async () => {
      const res = await listErc20Balances(addr, chainId, { pageSize: 25 });
      return (res.erc20TokenBalances ?? [])
        .filter((t) => t.balance !== "0")
        .map((t) => ({
          address: t.address,
          symbol: t.symbol,
          name: t.name,
          balance: t.balance,
          decimals: t.decimals,
        }));
    }),
    section<DataSummary["nfts"]>("nfts", [], async () => {
      const res = await listNfts(addr, chainId, { pageSize: 24 });
      return (res.erc721TokenBalances ?? []).map((n) => ({
        address: n.address,
        name: n.name,
        symbol: n.symbol,
        tokenId: n.tokenId,
      }));
    }),
    section<DataSummary["transactions"]>("transactions", [], async () => {
      const res = await listTransactions(addr, chainId, { pageSize: 15 });
      return (res.transactions ?? []).map((tx) => ({
        txHash: tx.nativeTransaction.txHash,
        from: tx.nativeTransaction.from.address,
        to: tx.nativeTransaction.to?.address ?? "",
        timestamp: tx.nativeTransaction.blockTimestamp,
        method: tx.nativeTransaction.method?.methodName ?? null,
        status: tx.nativeTransaction.txStatus,
      }));
    }),
  ]);

  return { native, tokens, nfts, transactions, errors };
}
