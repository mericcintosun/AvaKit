/**
 * Read-only chain data via viem's public client. Primary source is RPC;
 * richer indexed data (Glacier / AvaCloud) can be layered in later.
 */

import type { Abi, Address, ContractFunctionName, Hex } from "viem";
import type { AvaChain } from "./chains.js";
import { getPublicClient } from "./clients.js";

/** Native AVAX balance in wei. */
export function getBalance(address: Address, chain: AvaChain): Promise<bigint> {
  return getPublicClient(chain).getBalance({ address });
}

/** Wait-free transaction receipt lookup. */
export function getTransactionReceipt(hash: Hex, chain: AvaChain) {
  return getPublicClient(chain).getTransactionReceipt({ hash });
}

export interface ReadContractParams<TAbi extends Abi> {
  address: Address;
  abi: TAbi;
  functionName: ContractFunctionName<TAbi, "pure" | "view">;
  args?: readonly unknown[];
}

/** Call a view/pure function on a contract. */
export function readContract<TAbi extends Abi>(
  chain: AvaChain,
  params: ReadContractParams<TAbi>,
): Promise<unknown> {
  return getPublicClient(chain).readContract({
    address: params.address,
    abi: params.abi,
    functionName: params.functionName,
    args: params.args,
  } as Parameters<ReturnType<typeof getPublicClient>["readContract"]>[0]);
}
