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

/**
 * A provider that can switch to a full `AvaChain` by itself (non-standard).
 *
 * `wallet_switchEthereumChain` carries nothing but a chain id. AvaKit's burner
 * provider needs more than that to really switch: the chain's RPC URL, and the
 * `testnet` flag it enforces (it refuses every mainnet). So it exposes this
 * method, and `ensureChain` prefers it over the EIP-3326 request when present.
 */
export interface AvaChainSwitcher {
  avakitSwitchChain(chain: AvaChain): Promise<void>;
}

/**
 * Switch the wallet to `chain`, adding it first if unknown (EIP-3085/3326).
 * Resolves once the wallet is on the chain, so a transaction can be sent right
 * after awaiting it.
 */
export async function ensureChain(provider: EIP1193Provider, chain: AvaChain): Promise<void> {
  const direct = (provider as Partial<AvaChainSwitcher>).avakitSwitchChain;
  if (typeof direct === "function") {
    await direct.call(provider, chain);
    return;
  }
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
            // A fresh L1 has no explorer yet (defineChain allows a blank URL).
            // EIP-3085 makes the field optional, and wallets reject an empty
            // string in it — so leave it out rather than send [""].
            ...(chain.explorerUrl ? { blockExplorerUrls: [chain.explorerUrl] } : {}),
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
