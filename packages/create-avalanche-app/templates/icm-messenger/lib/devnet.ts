/**
 * Local ICM devnet configuration.
 *
 * `scripts/devnet.sh` spins up two Avalanche L1s with Interchain Messaging and a
 * relayer, then writes the discovered RPC URLs and blockchain IDs into
 * `icm.config.json`. This module turns that into AvaKit chains the app can use.
 */

import { type AvaChain, defineChain } from "@avakit/core/chains";
import config from "../icm.config.json";

export interface IcmChainConfig {
  name: string;
  token: string;
  /** EVM chain id (for the wallet / RPC). */
  evmChainId: number;
  rpcUrl: string;
  /** The bytes32 (Avalanche) blockchain ID in hex — Teleporter's routing key. */
  blockchainIdHex: string;
}

export interface IcmConfig {
  configured: boolean;
  /** TeleporterMessenger predeploy, the same address on every ICM-enabled chain. */
  teleporterMessenger: string;
  chain1: IcmChainConfig;
  chain2: IcmChainConfig;
}

export const icm = config as IcmConfig;

/** True once `pnpm devnet` has filled in the two chains' RPC URLs. */
export const isConfigured = Boolean(
  icm.configured && icm.chain1.rpcUrl && icm.chain2.rpcUrl,
);

function toAvaChain(c: IcmChainConfig): AvaChain {
  return defineChain({
    id: c.evmChainId,
    name: c.name,
    rpcUrl: c.rpcUrl || "http://127.0.0.1:9650",
    explorerUrl: "",
    nativeCurrency: { name: c.token, symbol: c.token, decimals: 18 },
    testnet: true,
  });
}

export const chain1 = toAvaChain(icm.chain1);
export const chain2 = toAvaChain(icm.chain2);

/** The two local chains, indexed the way the UI pairs them. */
export const localChains: [AvaChain, AvaChain] = [chain1, chain2];

/** Blockchain ID (bytes32 hex) for a given local chain — needed to send to it. */
export function blockchainIdOf(chain: AvaChain): `0x${string}` {
  const hex = chain.id === icm.chain1.evmChainId ? icm.chain1.blockchainIdHex : icm.chain2.blockchainIdHex;
  return hex as `0x${string}`;
}
