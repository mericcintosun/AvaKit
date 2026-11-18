/**
 * Contract deployment helper. Takes a compiled artifact + an EIP-1193 provider
 * and deploys to an AvaChain, returning the address and an explorer link.
 *
 * Reading artifacts from disk (Foundry `out/*.json`) belongs to the CLI/MCP
 * (Node-only). Here we accept an already-parsed artifact so this stays
 * browser-safe.
 */

import {
  type Abi,
  type Address,
  type EIP1193Provider,
  encodeDeployData,
  formatUnits,
  getAddress,
  type Hex,
  type PublicClient,
} from "viem";
import { type AvaChain, isMainnet } from "./chains.js";
import { getPublicClient, getWalletClient } from "./clients.js";
import {
  DeployFailedError,
  InsufficientFundsError,
  MainnetConfirmationError,
  missingTestnetFlagHint,
} from "./errors.js";

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
   * Required to deploy to a mainnet chain. AvaKit is testnet-first: deploying to
   * a mainnet costs real funds, so it refuses unless you opt in explicitly. A
   * mainnet is any chain that `isMainnet()` does not recognise as a testnet,
   * i.e. one that does not say `testnet: true`, or whose id is a known mainnet.
   *
   * With the flag set, the account's balance is still checked against the
   * estimated cost before anything is sent; a deployment the account cannot pay
   * for is refused with `InsufficientFundsError`. No effect on testnet chains
   * (e.g. Fuji).
   */
  confirmMainnet?: boolean;
}

export interface DeployResult {
  /** The new contract, checksummed. Its code was read back before this was returned. */
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

function reason(cause: unknown): string {
  if (typeof cause === "object" && cause !== null) {
    const { shortMessage, message } = cause as { shortMessage?: unknown; message?: unknown };
    if (typeof shortMessage === "string") return shortMessage;
    if (typeof message === "string") return message;
  }
  return String(cause);
}

/**
 * The balance check of the mainnet guardrail: refuse a deployment the account
 * cannot pay for, before the wallet is asked to sign anything. The cost is the
 * node's gas estimate at its current gas price, which is about the least the
 * deployment can cost (wallets reserve somewhat more), so an account that can
 * afford the deployment is not held back. If the cost cannot be worked out (the
 * constructor would revert, the RPC is unreachable) the deployment is refused
 * as well: on a mainnet, no check means no deploy.
 */
async function assertCanPayForDeploy(
  publicClient: PublicClient,
  chain: AvaChain,
  account: Address,
  data: Hex,
): Promise<void> {
  let balance: bigint;
  let cost: bigint;
  try {
    const [held, gas, gasPrice] = await Promise.all([
      publicClient.getBalance({ address: account }),
      publicClient.estimateGas({ account, data }),
      publicClient.getGasPrice(),
    ]);
    balance = held;
    cost = gas * gasPrice;
  } catch (cause) {
    throw new DeployFailedError(
      `Could not work out what this deployment costs on ${chain.name}, so nothing was sent: ` +
        reason(cause),
      { cause },
    );
  }
  if (balance < cost) {
    const { symbol, decimals } = chain.nativeCurrency;
    throw new InsufficientFundsError(
      undefined,
      `${account} holds ${formatUnits(balance, decimals)} ${symbol} on ${chain.name}, but this ` +
        `deployment is estimated to cost ${formatUnits(cost, decimals)} ${symbol}. ` +
        "Fund the account and try again; nothing was sent.",
    );
  }
}

/**
 * Waits between the reads of the new contract's code: one read straight away,
 * then one after each of these. Two seconds in all, and never more reads than
 * this list allows, so a deployment that left no code fails promptly.
 */
const CODE_CHECK_WAITS_MS = [200, 300, 500, 1000] as const;
const CODE_CHECK_SECONDS = CODE_CHECK_WAITS_MS.reduce((sum, wait) => sum + wait, 0) / 1000;

/**
 * The second half of "deployed": the address has to hold code. A receipt with
 * `status: success` is not proof of that. A creation whose bytecode returns no
 * runtime code (a constructor that self-destructs, or runtime bytecode passed
 * where creation bytecode belongs) succeeds and leaves an empty account behind,
 * and every later call to it "works" while doing nothing.
 *
 * One empty read is not proof of the opposite either. The read can run ahead of
 * the state it asks about: a load-balanced RPC may answer from a node that has
 * not caught up with the one that served the receipt, and since Avalanche's
 * Helicon upgrade a block is accepted before it has been executed. So an empty
 * or failed read is repeated for about two seconds before the deployment is
 * given up on.
 */
async function assertCodeAt(
  publicClient: PublicClient,
  chain: AvaChain,
  address: Address,
  txHash: Hex,
): Promise<void> {
  let reads = 0;
  // Why the most recent read did not find code: it threw, or (undefined) the
  // node answered that the account is empty.
  let failure: unknown;
  for (;;) {
    reads += 1;
    try {
      if (await publicClient.getCode({ address })) {
        return;
      }
      failure = undefined;
    } catch (cause) {
      failure = cause;
    }
    const wait = CODE_CHECK_WAITS_MS[reads - 1];
    if (wait === undefined) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  const where = chain.explorerUrl ? ` (${chain.explorerUrl}/tx/${txHash})` : "";
  if (failure !== undefined) {
    throw new DeployFailedError(
      `Deployment transaction ${txHash} succeeded on ${chain.name} and names ${address} as the ` +
        `new contract, but its code could not be read back to confirm it (${reads} attempts). ` +
        `Check the transaction${where} before using the address. The last read failed with: ` +
        reason(failure),
      { cause: failure },
    );
  }
  throw new DeployFailedError(
    `Deployment transaction ${txHash} succeeded on ${chain.name}, but there is no contract ` +
      `code at ${address} (read ${reads} times over ${CODE_CHECK_SECONDS} seconds). Nothing ` +
      "usable was deployed: make sure the artifact holds creation bytecode and that the " +
      `constructor does not self-destruct, and check the transaction${where}.`,
  );
}

/**
 * Deploy a compiled contract and wait until it exists.
 *
 * Resolves only once the deployment transaction has succeeded and the code is
 * on chain at the new address. Rejects with `DeployFailedError` when the
 * transaction reverted, created no contract, or left no code behind; with
 * `MainnetConfirmationError` on a mainnet without `confirmMainnet`; and with
 * `InsufficientFundsError` when a confirmed mainnet deployment cannot be paid
 * for.
 */
export async function deployContract(params: DeployParams): Promise<DeployResult> {
  const { artifact, args, chain, provider, account, confirmMainnet } = params;
  // Testnet-first guardrail: never deploy to a mainnet chain without opt-in.
  // isMainnet() also catches a known mainnet id mislabelled testnet (audit A9)
  // and a definition that never said `testnet: true` at all.
  const mainnet = isMainnet(chain);
  if (mainnet && !confirmMainnet) {
    throw new MainnetConfirmationError(chain.name, missingTestnetFlagHint(chain));
  }
  const walletClient = getWalletClient(chain, provider);
  const publicClient = getPublicClient(chain);
  const bytecode = getBytecode(artifact);

  // The confirmation is half of the mainnet guardrail; the balance check is the
  // other half.
  if (mainnet) {
    await assertCanPayForDeploy(
      publicClient,
      chain,
      account,
      encodeDeployData({
        abi: artifact.abi,
        bytecode,
        args: args as readonly unknown[] | undefined,
      } as Parameters<typeof encodeDeployData>[0]),
    );
  }

  // The wallet client already carries the chain; account is a JSON-RPC address.
  const txHash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode,
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
  // Succeeded is still not deployed until the code is there to call.
  const address = getAddress(receipt.contractAddress);
  await assertCodeAt(publicClient, chain, address, txHash);

  return {
    address,
    txHash,
    // A fresh L1 has no explorer; an empty string is more honest than a
    // relative "/address/0x…" link that points back into the app.
    explorerUrl: chain.explorerUrl ? `${chain.explorerUrl}/address/${receipt.contractAddress}` : "",
  };
}
