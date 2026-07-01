/**
 * viem client factory. Turns an AvaChain into viem public/wallet clients with
 * sensible Avalanche defaults. Wallet clients are created from an EIP-1193
 * provider supplied by a WalletAdapter — AvaKit never touches private keys.
 */

import {
  type Chain,
  createPublicClient,
  createWalletClient,
  custom,
  type EIP1193Provider,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import type { AvaChain } from "./chains.js";

/** Convert an AvaChain into the viem `Chain` shape. */
export function toViemChain(chain: AvaChain): Chain {
  return {
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: {
      default: { http: [chain.rpcUrl] },
    },
    blockExplorers: {
      default: { name: "Explorer", url: chain.explorerUrl },
    },
    testnet: chain.testnet,
  };
}

/** Read-only client backed by the chain's HTTP RPC. */
export function getPublicClient(chain: AvaChain): PublicClient {
  return createPublicClient({
    chain: toViemChain(chain),
    transport: http(chain.rpcUrl),
  });
}

/** Wallet client backed by an EIP-1193 provider (from a WalletAdapter). */
export function getWalletClient(chain: AvaChain, provider: EIP1193Provider): WalletClient {
  return createWalletClient({
    chain: toViemChain(chain),
    transport: custom(provider),
  });
}
