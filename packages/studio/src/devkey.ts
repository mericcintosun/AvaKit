/**
 * The one key Studio signs with, and the only way to use it.
 *
 * Studio signs its Interchain transactions (deploying the messengers, linking
 * them, sending a message) with EWOQ, so that a message can cross two local L1s
 * without a wallet. Everything about that key has to stay local:
 *
 *  - It never leaves this process. Transactions are signed here, with viem, and
 *    reach the L1 as raw signed transactions over JSON-RPC. No command line
 *    carries the key (every user on the machine can read every process's
 *    arguments), and no error message repeats it.
 *  - It signs only for a local devnet: the L1's RPC URL must be on this machine
 *    (loopback), and that RPC must answer for the chain ID avalanche-cli created
 *    the L1 with. Anything else is refused before a transaction is built, and
 *    an RPC that answers with a redirect is not followed anywhere.
 */

import { BaseError, createWalletClient, defineChain, type Hex, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { InputError } from "./errors.js";

/**
 * EWOQ: the well-known private key that avalanche-cli funds on every LOCAL
 * network it starts, published in Avalanche's own documentation. It is public
 * on purpose. Anyone can read it and spend from it, so it holds nothing of
 * value and is not a secret. For that same reason it must never sign for
 * anything but a local devnet, and the only code that may use it is
 * `sendWithDevnetKey` below, which refuses anything else.
 */
const EWOQ_LOCAL_DEVNET_KEY =
  "0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027" as const;

const account = privateKeyToAccount(EWOQ_LOCAL_DEVNET_KEY);

/** EWOQ's address, the same on every EVM chain. */
export const EWOQ_ADDRESS = account.address;

/** How long the L1 gets to mine a transaction (as `cast send` was given). */
const RECEIPT_TIMEOUT_MS = 90_000;

/** How long one JSON-RPC request may take. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Whether `rpcUrl` is served by this machine: http(s) to `localhost`,
 * 127.0.0.0/8 or ::1. Parsed with the WHATWG URL parser, so `127.1` and
 * `0x7f.1` come out as 127.0.0.1, and a name such as
 * `127.0.0.1.attacker.example` is not taken for an address.
 */
export function isLocalRpcUrl(rpcUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname;
  return host === "localhost" || host === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/** Where an RPC URL points ("127.0.0.1:9650"), short enough to quote in a message. */
export function rpcHost(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).host.slice(0, 100) || "no host";
  } catch {
    return "not a URL";
  }
}

/** The local L1 a transaction is for, as avalanche-cli recorded it. */
export interface DevnetTarget {
  /** The L1's name, for messages. */
  name: string;
  /** Its RPC URL on the local network. */
  rpcUrl: string;
  /** The EVM chain ID avalanche-cli created it with; null when its genesis does not say. */
  evmChainId: number | null;
}

export interface DevnetTransaction {
  /** The contract to call; leave it out to deploy `data` as a new contract. */
  to?: Hex;
  data: Hex;
}

export interface DevnetReceipt {
  transactionHash: Hex;
  /** The new contract's address, for a deployment. */
  contractAddress: Hex | null;
}

/** Why `rpcUrl` may not be signed for with EWOQ, or null when it may. */
export function devnetKeyRefusal(name: string, rpcUrl: string): string | null {
  return isLocalRpcUrl(rpcUrl)
    ? null
    : `${name}'s RPC URL (${rpcHost(rpcUrl)}) is not on this machine: Studio signs only for local devnets, with the public EWOQ devnet key`;
}

/** viem's words for a failure, without the long tail of request details. */
function failure(e: unknown): string {
  const text =
    e instanceof BaseError
      ? e.details && !e.shortMessage.includes(e.details)
        ? `${e.shortMessage} (${e.details})`
        : e.shortMessage
      : e instanceof Error
        ? e.message
        : String(e);
  return text.slice(0, 600);
}

/**
 * Sign `tx` with EWOQ, send it to the local L1 `target`, and wait until it is
 * mined. Refused (InputError, before anything is signed) when the L1's RPC URL
 * is not on this machine, or when its RPC answers for another chain than the
 * one avalanche-cli created. A transaction that is mined but reverts is a
 * failure.
 */
export async function sendWithDevnetKey(
  target: DevnetTarget,
  tx: DevnetTransaction,
): Promise<DevnetReceipt> {
  const refusal = devnetKeyRefusal(target.name, target.rpcUrl);
  if (refusal) throw new InputError(refusal);

  const client = createWalletClient({
    account,
    transport: http(target.rpcUrl, {
      retryCount: 0,
      timeout: REQUEST_TIMEOUT_MS,
      // A redirect could take the signed transaction to another machine.
      fetchOptions: { redirect: "error" },
    }),
    pollingInterval: 250,
  }).extend(publicActions);

  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch (e) {
    throw new Error(failure(e));
  }
  if (target.evmChainId !== null && chainId !== target.evmChainId) {
    throw new InputError(
      `${target.name}'s RPC answers for chain ID ${chainId}, not the chain ID ${target.evmChainId} avalanche-cli created it with: Studio does not sign there`,
    );
  }
  const chain = defineChain({
    id: chainId,
    name: target.name,
    nativeCurrency: { name: "Native token", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [target.rpcUrl] } },
  });

  try {
    const hash = await client.sendTransaction({ chain, to: tx.to ?? null, data: tx.data });
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    if (receipt.status !== "success") throw new Error("the transaction was mined but reverted");
    return {
      transactionHash: receipt.transactionHash,
      contractAddress: receipt.contractAddress ?? null,
    };
  } catch (e) {
    throw new Error(failure(e));
  }
}
