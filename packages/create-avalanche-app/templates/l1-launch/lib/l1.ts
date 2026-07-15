/**
 * Your Avalanche L1 configuration.
 *
 * `scripts/l1.sh` (`pnpm l1`) creates a Subnet-EVM chain, deploys it to a local
 * Avalanche network, and writes the discovered RPC URL + blockchain ID into
 * `l1.config.json`. This module turns that into an AvaKit chain the app uses.
 */

import { type AvaChain, defineChain } from "@avakit/core/chains";
import config from "../l1.config.json";

export interface L1Config {
  configured: boolean;
  /** "local" (pnpm l1) or "fuji" (pnpm l1:fuji). */
  network: string;
  name: string;
  token: string;
  /** EVM chain id (for the wallet / RPC). */
  evmChainId: number;
  rpcUrl: string;
  /** The bytes32 (Avalanche) blockchain ID in hex. */
  blockchainIdHex: string;
  /** EWOQ dev key on local networks (empty on Fuji — bring your own wallet). */
  faucetAccount: { address: string; privateKey: string };
}

export const l1 = config as L1Config;

/** True once `pnpm l1` has filled in the chain's RPC URL. */
export const isConfigured = Boolean(l1.configured && l1.rpcUrl);

/** Your L1 as an AvaKit chain. The explorer is built into this app (see components/demo.tsx). */
export const chain: AvaChain = defineChain({
  id: l1.evmChainId,
  name: l1.name,
  rpcUrl: l1.rpcUrl || "http://127.0.0.1:9650",
  explorerUrl: "",
  nativeCurrency: { name: l1.token, symbol: l1.token, decimals: 18 },
  testnet: true,
});
