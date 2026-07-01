/**
 * Network helpers. Ensures a connected wallet is on the target Avalanche chain,
 * adding it first if the wallet doesn't know it. Works for injected wallets
 * (Core / MetaMask prompt the user) and embedded wallets (Web3Auth switches
 * silently).
 */

import type { EIP1193Provider } from "viem";
import type { AvaChain } from "./chains.js";

function errorCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

/** Switch the wallet to `chain`, adding it first if unknown (EIP-3085/3326). */
export async function ensureChain(provider: EIP1193Provider, chain: AvaChain): Promise<void> {
  const chainId = `0x${chain.id.toString(16)}` as const;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (error) {
    // 4902 = chain not added to the wallet yet.
    if (errorCode(error) === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [chain.rpcUrl],
            blockExplorerUrls: [chain.explorerUrl],
          },
        ],
      });
      // Some wallets add without switching — switch explicitly afterwards.
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }],
      });
    } else {
      throw error;
    }
  }
}
