/**
 * Local ICTT bridge configuration.
 *
 * `scripts/bridge.sh` (`pnpm bridge`) spins up two Avalanche L1s and deploys a
 * full Interchain Token Transfer bridge across them, writing every address into
 * `bridge.config.json`. This module turns that into AvaKit chains + the ABIs the
 * app needs to bridge tokens.
 */

import { type AvaChain, defineChain } from "@avakit/core/chains";
import type { Abi, Address } from "viem";
import artifacts from "./ictt-artifacts.json";
import config from "../bridge.config.json";

export interface BridgeChainConfig {
  name: string;
  token: string;
  evmChainId: number;
  rpcUrl: string;
  /** The bytes32 (Avalanche) blockchain ID in hex — ICM's routing key. */
  blockchainIdHex: string;
}

export interface BridgeAddresses {
  /** The demo ERC-20 on chain1 (the token you bridge). */
  demoToken: Address;
  registry1: Address;
  /** ERC20TokenHome on chain1 — locks the token and sends it across. */
  home: Address;
  registry2: Address;
  /** ERC20TokenRemote on chain2 — the bridged token (itself an ERC-20). */
  remote: Address;
}

export interface BridgeConfig {
  configured: boolean;
  chain1: BridgeChainConfig;
  chain2: BridgeChainConfig;
  bridge: BridgeAddresses | null;
}

export const bridge = config as BridgeConfig;

/** True once `pnpm bridge` has deployed everything and filled in the addresses. */
export const isConfigured = Boolean(bridge.configured && bridge.bridge);

function toAvaChain(c: BridgeChainConfig): AvaChain {
  return defineChain({
    id: c.evmChainId,
    name: c.name,
    rpcUrl: c.rpcUrl || "http://127.0.0.1:9650",
    explorerUrl: "",
    nativeCurrency: { name: c.token, symbol: c.token, decimals: 18 },
    testnet: true,
  });
}

export const homeChain = toAvaChain(bridge.chain1);
export const remoteChain = toAvaChain(bridge.chain2);

/** Blockchain ID (bytes32 hex) for a chain — the ICM/ICTT routing key. */
export function blockchainIdOf(chain: AvaChain): `0x${string}` {
  const hex = chain.id === bridge.chain1.evmChainId ? bridge.chain1.blockchainIdHex : bridge.chain2.blockchainIdHex;
  return hex as `0x${string}`;
}

// ABIs from the embedded artifacts (compiled from ava-labs/icm-contracts).
export const homeAbi = artifacts.ERC20TokenHome.abi as Abi;
export const remoteAbi = artifacts.ERC20TokenRemote.abi as Abi;
export const erc20Abi = artifacts.DemoToken.abi as Abi;
