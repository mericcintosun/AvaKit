import type { AvaChain } from "@avakit/core";
import {
  type Abi,
  type Address,
  encodeDeployData,
  getAddress,
  getContractAddress,
  type Hex,
  isAddress,
} from "viem";
import { constructorArgs } from "./abi.js";
import { reasonOf, ToolError } from "./errors.js";
import { codeExists, explorerTx, type SignedBy, send, signedBy } from "./send.js";
import type { Signer } from "./wallet.js";

/** The parts of a mined transaction's receipt that decide a deploy's outcome. */
export interface DeployReceipt {
  status: "success" | "reverted";
  contractAddress?: string | null;
}

/** A deployed contract: where it is, and where to look it up when the chain has an explorer. */
export interface Deployed {
  /** The new contract, checksummed. */
  address: Address;
  txHash: Hex;
  /** Explorer link for the contract. Left out when the chain has no explorer. */
  explorerUrl?: string;
}

export type DeployOutcome = { ok: true; result: Deployed } | { ok: false; message: string };

/**
 * Decide whether a mined creation transaction really deployed a contract.
 *
 * `contractAddress` on its own is not evidence. A node fills it in for every
 * creation transaction — it is derived from the sender and nonce, not from the
 * result — so a transaction whose constructor reverted still carries one, with
 * no code behind it. Only `status` says whether the creation succeeded, so it
 * is checked first and a reverted deploy is never reported as an address.
 *
 * The address is returned with its EIP-55 checksum, as `waitForDeployment` in
 * @avakit/core returns it. An agent copies it into its next call, and
 * `write_contract` refuses a mixed-case address whose checksum does not hold,
 * so a character changed on the way is caught instead of called.
 *
 * Explorer links come from the chain's definition and are left out for a chain
 * that has no explorer.
 */
export function deployOutcome(receipt: DeployReceipt, txHash: Hex, chain: AvaChain): DeployOutcome {
  if (receipt.status !== "success") {
    return {
      ok: false,
      message:
        `Deployment reverted: transaction ${txHash} was mined on ${chain.name}, but no ` +
        `contract was created (the constructor reverted or ran out of gas). Check the ` +
        `constructor arguments and the bytecode.${linked(explorerTx(chain, txHash))}`,
    };
  }
  if (!receipt.contractAddress || !isAddress(receipt.contractAddress, { strict: false })) {
    return { ok: false, message: "Deployment did not return a contract address." };
  }
  const address = getAddress(receipt.contractAddress);
  return {
    ok: true,
    result: {
      address,
      txHash,
      ...(chain.explorerUrl ? { explorerUrl: `${chain.explorerUrl}/address/${address}` } : {}),
    },
  };
}

/** A link to end a sentence with, or nothing when there is none. */
function linked(url: string): string {
  return url ? ` ${url}` : "";
}

export interface DeployRequest {
  abi: Abi;
  /** Creation bytecode, 0x-prefixed. */
  bytecode: Hex;
  args?: readonly unknown[];
}

export type DeployResult = Deployed & SignedBy;

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
  const where = linked(explorerTx(chain, sent.hash));
  let hasCode: boolean;
  try {
    // Patiently: the transaction is mined, so a read that fails is repeated.
    hasCode = await codeExists(chain, address, true);
  } catch (error) {
    throw new ToolError(
      `Transaction ${sent.hash} succeeded on ${chain.name} and should have created a contract at ` +
        `${address}, but the node could not be asked whether the code is there (${reasonOf(error)}). ` +
        `Check it before deploying again, so that it is not deployed twice.${where}`,
    );
  }
  if (!hasCode) {
    throw new ToolError(
      `Transaction ${sent.hash} succeeded on ${chain.name}, but there is no contract code at ` +
        `${address}: the bytecode ran and left nothing behind. Make sure it is the creation bytecode ` +
        `(Foundry's bytecode.object), not the deployed runtime bytecode.${where}`,
    );
  }
  return { ...outcome.result, ...signedBy(signer, sent) };
}
