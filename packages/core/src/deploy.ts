/**
 * Contract deployment helper. Takes a compiled artifact + an EIP-1193 provider
 * and deploys to an AvaChain, returning the address and an explorer link.
 *
 * Reading artifacts from disk (Foundry `out/*.json`) belongs to the CLI/MCP
 * (Node-only). Here we accept an already-parsed artifact so this stays
 * browser-safe.
 */

import { type Abi, type Address, type EIP1193Provider, getAddress, type Hex } from "viem";
import { type AvaChain, isMainnet } from "./chains.js";
import { getPublicClient, getWalletClient } from "./clients.js";
import { DeployFailedError, MainnetConfirmationError } from "./errors.js";

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
  /**
   * Required to deploy to a non-testnet (mainnet) chain. AvaKit is testnet-first:
   * deploying to a chain with `testnet: false` costs real funds, so it refuses
   * unless you opt in explicitly. No effect on testnet chains (e.g. Fuji).
   */
  confirmMainnet?: boolean;
}

export interface DeployResult {
  address: Address;
  txHash: Hex;
  /** Explorer link for the contract. Empty when the chain has no explorer. */
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
  const { artifact, args, chain, provider, account, confirmMainnet } = params;
  // Testnet-first guardrail: never deploy to a mainnet chain without opt-in.
  // isMainnet() also catches a known mainnet id mislabelled testnet. (audit A9)
  if (isMainnet(chain) && !confirmMainnet) {
    throw new MainnetConfirmationError(chain.name);
  }
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
  // Mined is not the same as deployed. A creation that ran out of gas or whose
  // constructor reverted still gets a receipt, and nodes fill `contractAddress`
  // on it anyway, so check the status before trusting the address: otherwise the
  // caller is handed an address with no code behind it.
  if (receipt.status !== "success") {
    throw new DeployFailedError(
      `Deployment transaction ${txHash} reverted on ${chain.name}, so no contract was created. ` +
        "Check the constructor arguments and the gas limit, then try again.",
    );
  }
  if (!receipt.contractAddress) {
    throw new DeployFailedError("Deployment transaction did not return a contract address.");
  }

  return {
    address: getAddress(receipt.contractAddress),
    txHash,
    // A fresh L1 has no explorer; an empty string is more honest than a
    // relative "/address/0x…" link that points back into the app.
    explorerUrl: chain.explorerUrl ? `${chain.explorerUrl}/address/${receipt.contractAddress}` : "",
  };
}
