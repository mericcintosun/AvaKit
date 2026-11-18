import { type AvaChain, getPublicClient, isMainnet } from "@avakit/core";
import { type Abi, type Address, encodeFunctionData, type Hex } from "viem";
import { describeFunction, selectFunction } from "./abi.js";
import { NO_REASON, reasonOf, revertReason, ToolError } from "./errors.js";
import { codeExists, explorerTx, type SignedBy, send, signedBy } from "./send.js";
import { DEPLOYER_KEY_ENV, type Signer } from "./wallet.js";

export interface WriteRequest {
  address: Address;
  abi: Abi;
  /** A function name, or a full signature to pick between overloads. */
  functionName: string;
  args?: readonly unknown[];
  /** Wei to send along. Only with the user's own key, and only on a testnet. */
  value?: bigint;
}

export type WriteResult = {
  txHash: Hex;
  status: "success";
  blockNumber: bigint;
  explorerUrl: string;
} & SignedBy;

/**
 * Send one state-changing contract call and report it only once it has
 * succeeded on chain.
 *
 * A call can be sent and mined and still have done nothing, in three ways, and
 * each is turned into an error here rather than a `status: "success"`:
 *
 *   • there is no contract at the address — a call to an empty account succeeds
 *     and changes nothing, so the address is checked for code first;
 *   • the call would revert — it is simulated first, and the revert reason comes
 *     back without a transaction or its gas being spent;
 *   • it reverts on chain after all — the receipt's status is checked.
 */
export async function writeContract(
  chain: AvaChain,
  signer: Signer,
  request: WriteRequest,
): Promise<WriteResult> {
  const { address, abi } = request;
  const { item, args } = selectFunction(abi, request.functionName, request.args);
  const value = request.value ?? 0n;

  if (value > 0n) {
    if (item.stateMutability !== "payable") {
      throw new ToolError(
        `"${item.name}" is not payable, so it cannot be sent AVAX. Leave value out.`,
      );
    }
    if (signer.source === "session") {
      throw new ToolError(
        "The session test wallet never sends AVAX with a call: it pays for gas on Fuji and nothing " +
          `else. To call a payable function with value, set ${DEPLOYER_KEY_ENV} to your own funded Fuji key.`,
      );
    }
    if (isMainnet(chain)) {
      throw new ToolError(
        `write_contract does not send AVAX on ${chain.name} (mainnet): value is for testnets only.`,
      );
    }
  }

  let data: Hex;
  try {
    data = encodeFunctionData({ abi: [item], functionName: item.name, args });
  } catch (error) {
    throw new ToolError(
      `Could not encode the arguments for ${describeFunction(item)}, so nothing was sent: ${reasonOf(error)}`,
    );
  }

  let hasCode: boolean;
  try {
    hasCode = await codeExists(chain, address);
  } catch (error) {
    throw new ToolError(
      `Could not reach ${chain.name} (${chain.rpcUrl}), so nothing was sent: ${reasonOf(error)}`,
    );
  }
  if (!hasCode) {
    throw new ToolError(
      `There is no contract at ${address} on ${chain.name}, so nothing was sent. Check the address ` +
        "(deploy_contract returns it) and that this is the chain it was deployed to.",
    );
  }

  try {
    await getPublicClient(chain).simulateContract({
      account: signer.address,
      address,
      abi: [
        // Without its outputs: the return value is not used here, and an ABI
        // that declares the wrong one (a `returns (bool)` the contract does not
        // have) must not make a call that would succeed look like a failure.
        { ...item, outputs: [] },
        // With the contract's errors, so a revert can be reported by name.
        ...abi.filter((entry) => entry.type === "error"),
      ],
      functionName: item.name,
      args,
      ...(value > 0n ? { value } : {}),
    } as never);
  } catch (error) {
    const reverted = revertReason(error, abi);
    if (!reverted) {
      throw new ToolError(
        `Could not simulate ${describeFunction(item)} on ${chain.name}, so nothing was sent: ${reasonOf(error)}`,
      );
    }
    throw new ToolError(
      `Simulating ${describeFunction(item)} on ${chain.name} reverted, so nothing was sent. Reason: ${reverted}.` +
        // A contract with no such function, and no fallback, answers like this too.
        (reverted === NO_REASON
          ? ` A contract also reverts this way when it has no function "${item.name}": check that the ABI belongs to the contract at ${address}.`
          : ""),
    );
  }

  const sent = await send(chain, signer, { kind: "transaction", to: address, data, value, abi });
  const where = explorerTx(chain, sent.hash);
  if (sent.receipt.status !== "success") {
    throw new ToolError(
      `Transaction ${sent.hash} was mined on ${chain.name} but reverted, so nothing changed. The ` +
        "simulation passed just before it was sent: the contract's state changed in between, or the " +
        `call ran out of gas. ${where}`,
    );
  }
  return {
    txHash: sent.hash,
    status: "success",
    blockNumber: sent.receipt.blockNumber,
    explorerUrl: where,
    ...signedBy(signer, sent),
  };
}
