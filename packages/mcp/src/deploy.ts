import type { AvaChain } from "@avakit/core";
import { type Abi, type Address, encodeDeployData, getContractAddress, type Hex } from "viem";
import { constructorArgs } from "./abi.js";
import { reasonOf, ToolError } from "./errors.js";
import { codeExists, explorerTx, type SignedBy, send, signedBy } from "./send.js";
import type { Signer } from "./wallet.js";

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

export interface DeployRequest {
  abi: Abi;
  /** Creation bytecode, 0x-prefixed. */
  bytecode: Hex;
  args?: readonly unknown[];
}

export type DeployResult = { address: Address; txHash: Hex; explorerUrl: string } & SignedBy;

/**
 * Deploy a contract and return its address — but only an address that has a
 * contract at it.
 *
 * Three things have to be true, and each has been seen to be false on its own:
 * the transaction was mined, its status is success (see `deployOutcome`), and
 * there is code at the address. A creation whose bytecode returns nothing — the
 * deployed (runtime) bytecode passed where the creation bytecode belongs — is
 * mined, succeeds, and leaves an empty account behind.
 */
export async function deployContract(
  chain: AvaChain,
  signer: Signer,
  request: DeployRequest,
): Promise<DeployResult> {
  const args = constructorArgs(request.abi, request.args);
  let data: Hex;
  try {
    data = encodeDeployData({ abi: request.abi, bytecode: request.bytecode, args });
  } catch (error) {
    throw new ToolError(
      `Could not encode the constructor arguments, so nothing was sent: ${reasonOf(error)}`,
    );
  }

  const sent = await send(chain, signer, {
    kind: "deployment",
    data,
    abi: request.abi,
    whenPending: ({ nonce }) =>
      ` If it does, the contract will be at ${getContractAddress({ from: signer.address, nonce: BigInt(nonce) })}.`,
  });
  const outcome = deployOutcome(sent.receipt, sent.hash, chain);
  if (!outcome.ok) throw new ToolError(outcome.message);

  const { address } = outcome.result;
  const where = explorerTx(chain, sent.hash);
  let hasCode: boolean;
  try {
    hasCode = await codeExists(chain, address);
  } catch (error) {
    throw new ToolError(
      `Transaction ${sent.hash} succeeded on ${chain.name} and should have created a contract at ` +
        `${address}, but the node could not be asked whether the code is there (${reasonOf(error)}). ` +
        `Check it before deploying again, so that it is not deployed twice. ${where}`,
    );
  }
  if (!hasCode) {
    throw new ToolError(
      `Transaction ${sent.hash} succeeded on ${chain.name}, but there is no contract code at ` +
        `${address}: the bytecode ran and left nothing behind. Make sure it is the creation bytecode ` +
        `(Foundry's bytecode.object), not the deployed runtime bytecode. ${where}`,
    );
  }
  return { ...outcome.result, ...signedBy(signer, sent) };
}
