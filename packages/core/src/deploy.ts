/**
 * Contract deployment helper. Takes a compiled artifact + an EIP-1193 provider
 * and deploys to an AvaChain, returning the address and an explorer link.
 *
 * Reading artifacts from disk (Foundry `out/*.json`) belongs to the CLI/MCP
 * (Node-only). Here we accept an already-parsed artifact so this stays
 * browser-safe.
 */

import { type Abi, type Address, type EIP1193Provider, getAddress, type Hex } from "viem";
import type { AvaChain } from "./chains.js";
import { getPublicClient, getWalletClient } from "./clients.js";
import { DeployFailedError } from "./errors.js";

/** Shape of a parsed Foundry artifact (`out/Contract.sol/Contract.json`). */
export interface FoundryArtifact {
  abi: Abi;
  bytecode: { object: Hex } | Hex;
}

export interface DeployParams {
  artifact: FoundryArtifact | { abi: Abi; bytecode: Hex };
  args?: readonly unknown[];
  chain: AvaChain;
  provider: EIP1193Provider;
  account: Address;
}

export interface DeployResult {
  address: Address;
  txHash: Hex;
  explorerUrl: string;
}

/** Extract a 0x-prefixed bytecode string from either artifact shape. */
export function getBytecode(artifact: DeployParams["artifact"]): Hex {
  const { bytecode } = artifact;
  const object = typeof bytecode === "string" ? bytecode : bytecode.object;
  if (!object?.startsWith("0x")) {
    throw new DeployFailedError("Artifact bytecode is missing or not 0x-prefixed.");
  }
  return object as Hex;
}

export async function deployContract(params: DeployParams): Promise<DeployResult> {
  const { artifact, args, chain, provider, account } = params;
  const walletClient = getWalletClient(chain, provider);
  const publicClient = getPublicClient(chain);

  // The wallet client already carries the chain; account is a JSON-RPC address.
  const txHash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: getBytecode(artifact),
    args: args as readonly unknown[] | undefined,
    account,
  } as Parameters<typeof walletClient.deployContract>[0]);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (!receipt.contractAddress) {
    throw new DeployFailedError("Deployment transaction did not return a contract address.");
  }

  return {
    address: getAddress(receipt.contractAddress),
    txHash,
    explorerUrl: `${chain.explorerUrl}/address/${receipt.contractAddress}`,
  };
}
