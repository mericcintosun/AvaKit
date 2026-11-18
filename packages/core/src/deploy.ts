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

  return {
    address: getAddress(receipt.contractAddress),
    txHash,
    // A fresh L1 has no explorer; an empty string is more honest than a
    // relative "/address/0x…" link that points back into the app.
    explorerUrl: chain.explorerUrl ? `${chain.explorerUrl}/address/${receipt.contractAddress}` : "",
  };
}
