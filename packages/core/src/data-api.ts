/**
 * AvaCloud / Glacier Data API — indexed, read-only chain data (balances, NFTs,
 * transaction history) without running your own indexer.
 *
 * Works keyless against the public endpoint (rate-limited). Pass an `apiKey`
 * (from https://app.avacloud.io) for higher limits.
 *
 * Framework-agnostic: plain `fetch`, no React. The React hooks that wrap these
 * (`useTokenBalances`, `useNfts`, `useTxHistory`) live in `@avakit/react`.
 */

import type { Address } from "viem";
import { AvaKitError } from "./errors.js";

/** Public Glacier Data API base URL (keyless, rate-limited). */
export const DATA_API_BASE_URL = "https://glacier-api.avax.network/v1";

export interface DataApiOptions {
  /** AvaCloud API key sent as `x-glacier-api-key`. Optional — keyless works but is rate-limited. */
  apiKey?: string;
  /** Override the base URL (e.g. a self-hosted proxy). */
  baseUrl?: string;
  /** Page size (the API caps this at 100). */
  pageSize?: number;
  /** Opaque cursor from a previous response's `nextPageToken`. */
  pageToken?: string;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

export class DataApiError extends AvaKitError {
  override name = "DataApiError";
  readonly status: number;
  constructor(status: number, detail: string) {
    super(`Data API request failed (${status}): ${detail}`);
    this.status = status;
  }
}

export interface NativeTokenBalance {
  chainId: string;
  name: string;
  symbol: string;
  decimals: number;
  /** Balance in the smallest unit (wei), as a decimal string. */
  balance: string;
  logoUri?: string;
}

export interface Erc20TokenBalance {
  ercType: "ERC-20";
  chainId: string;
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  /** Balance in the smallest unit, as a decimal string. */
  balance: string;
  logoUri?: string;
  tokenReputation?: string | null;
}

export interface Erc721TokenBalance {
  ercType: "ERC-721";
  chainId: string;
  address: Address;
  name: string;
  symbol: string;
  tokenId: string;
  tokenUri?: string;
  ownerAddress: Address;
  metadata?: Record<string, unknown>;
}

export interface DataTransaction {
  nativeTransaction: {
    chainId: string;
    blockNumber: string;
    blockHash: string;
    blockTimestamp: number;
    txHash: string;
    /** "1" for success, "0" for failure. */
    txStatus: string;
    txType: number;
    gasLimit: string;
    gasUsed: string;
    gasPrice: string;
    nonce: string;
    from: { address: Address };
    to: { address: Address };
    value?: string;
    method?: { callType?: string; methodHash?: string; methodName?: string };
  };
  /** ERC-20 / ERC-721 transfer legs are included by the API when relevant. */
  [key: string]: unknown;
}

export interface NativeBalanceResponse {
  nativeTokenBalance: NativeTokenBalance;
}

export interface Erc20BalancesResponse {
  nativeTokenBalance: NativeTokenBalance;
  erc20TokenBalances: Erc20TokenBalance[];
  nextPageToken?: string;
}

export interface Erc721BalancesResponse {
  nativeTokenBalance: NativeTokenBalance;
  erc721TokenBalances: Erc721TokenBalance[];
  nextPageToken?: string;
}

export interface TransactionsResponse {
  transactions: DataTransaction[];
  nextPageToken?: string;
}

async function dataFetch<T>(path: string, opts: DataApiOptions): Promise<T> {
  const url = new URL(`${opts.baseUrl ?? DATA_API_BASE_URL}${path}`);
  if (opts.pageSize != null) url.searchParams.set("pageSize", String(opts.pageSize));
  if (opts.pageToken) url.searchParams.set("pageToken", opts.pageToken);

  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.apiKey) headers["x-glacier-api-key"] = opts.apiKey;

  const res = await fetch(url, { headers, signal: opts.signal });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new DataApiError(res.status, detail.slice(0, 200) || res.statusText);
  }
  return (await res.json()) as T;
}

/** Native AVAX balance for an address on the given EVM chain id (43113 = Fuji, 43114 = C-Chain). */
export function getNativeBalance(
  address: Address,
  chainId: number,
  opts: DataApiOptions = {},
): Promise<NativeBalanceResponse> {
  return dataFetch(`/chains/${chainId}/addresses/${address}/balances:getNative`, opts);
}

/** ERC-20 token balances (plus the native balance) held by an address. */
export function listErc20Balances(
  address: Address,
  chainId: number,
  opts: DataApiOptions = {},
): Promise<Erc20BalancesResponse> {
  return dataFetch(`/chains/${chainId}/addresses/${address}/balances:listErc20`, opts);
}

/** ERC-721 (NFT) holdings of an address. */
export function listNfts(
  address: Address,
  chainId: number,
  opts: DataApiOptions = {},
): Promise<Erc721BalancesResponse> {
  return dataFetch(`/chains/${chainId}/addresses/${address}/balances:listErc721`, opts);
}

/** Recent transactions for an address, newest first. */
export function listTransactions(
  address: Address,
  chainId: number,
  opts: DataApiOptions = {},
): Promise<TransactionsResponse> {
  return dataFetch(`/chains/${chainId}/addresses/${address}/transactions`, opts);
}
