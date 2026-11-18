import type { AvaChain } from "@avakit/core";
import type { Address, Hex } from "viem";

/** The parts of a mined transaction's receipt that decide a deploy's outcome. */
export interface DeployReceipt {
  status: "success" | "reverted";
  contractAddress?: string | null;
}

export type DeployOutcome =
  | { ok: true; result: { address: Address; txHash: Hex; explorerUrl: string } }
  | { ok: false; message: string };

/**
 * Decide whether a mined creation transaction really deployed a contract.
 *
 * `contractAddress` on its own is not evidence. A node fills it in for every
 * creation transaction — it is derived from the sender and nonce, not from the
 * result — so a transaction whose constructor reverted still carries one, with
 * no code behind it. Only `status` says whether the creation succeeded, so it
 * is checked first and a reverted deploy is never reported as an address.
 */
export function deployOutcome(receipt: DeployReceipt, txHash: Hex, chain: AvaChain): DeployOutcome {
  if (receipt.status !== "success") {
    return {
      ok: false,
      message:
        `Deployment reverted: transaction ${txHash} was mined on ${chain.name}, but no ` +
        `contract was created (the constructor reverted or ran out of gas). Check the ` +
        `constructor arguments and the bytecode. ${chain.explorerUrl}/tx/${txHash}`,
    };
  }
  if (!receipt.contractAddress) {
    return { ok: false, message: "Deployment did not return a contract address." };
  }
  return {
    ok: true,
    result: {
      address: receipt.contractAddress as Address,
      txHash,
      explorerUrl: `${chain.explorerUrl}/address/${receipt.contractAddress}`,
    },
  };
}
