import type { Address, Hex } from "viem";
import { FaucetError } from "./errors.js";

/**
 * Client for an AvaKit-hosted testnet faucet. The faucet holds the funding key
 * and enforces rate limits server-side, so a new user's first transaction is
 * funded with no wallet setup and no manual faucet visit. AvaKit code never
 * touches a private key here — it just calls the drip endpoint.
 */

export interface FaucetRequestOptions {
  /** Faucet endpoint that drips testnet AVAX (POST `{ address, chainId }`). */
  url: string;
  /** Address to fund. */
  address: Address;
  /** Target chain id (defaults to the faucet's own chain). */
  chainId?: number;
  /** Abort signal. */
  signal?: AbortSignal;
}

export interface FaucetResult {
  /** The drip transaction hash, if the faucet broadcast one. */
  txHash?: Hex;
  /** Amount dripped (human-readable), if reported. */
  amount?: string;
  /** Optional status message (e.g. "already funded"). */
  message?: string;
}

/** Ask the faucet to fund `address`. Throws `FaucetError` on a non-2xx response. */
export async function requestFaucet(options: FaucetRequestOptions): Promise<FaucetResult> {
  let res: Response;
  try {
    res = await fetch(options.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: options.address, chainId: options.chainId }),
      signal: options.signal,
    });
  } catch (e) {
    throw new FaucetError(`Faucet request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (await res.json().catch(() => ({}))) as FaucetResult & { error?: string };
  if (!res.ok) {
    throw new FaucetError(body.error ?? `Faucet request failed (HTTP ${res.status}).`, res.status);
  }
  return body;
}
