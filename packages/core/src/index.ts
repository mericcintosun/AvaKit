/**
 * @avakit/core
 *
 * Framework-agnostic kernel for AvaKit. Depends only on viem. React-specific
 * code lives in `@avakit/react`. See docs/06-spec-core-sdk.md.
 *
 * M1: chain registry, viem clients, wallet adapters (injected + Web3Auth),
 * deploy helper, and read-only chain data.
 */

export const VERSION = "0.1.0";

// Wallet adapters (web3auth lives at the `@avakit/core/web3auth` subpath)
export {
  type InjectedAdapterOptions,
  injectedAdapter,
  type WalletAdapter,
  type WalletConnection,
} from "./adapters/index.js";
// Chains
export {
  type AvaChain,
  type BuiltinChainSlug,
  cChain,
  chains,
  defineChain,
  fuji,
} from "./chains.js";
// viem clients
export { getPublicClient, getWalletClient, toViemChain } from "./clients.js";
// Data
export { getBalance, getTransactionReceipt, readContract } from "./data.js";
// Deploy
export {
  type DeployParams,
  type DeployResult,
  deployContract,
  type FoundryArtifact,
  getBytecode,
} from "./deploy.js";
// Errors
export {
  AvaKitError,
  ChainMismatchError,
  DeployFailedError,
  InsufficientFundsError,
  WalletConnectionError,
  WalletNotAvailableError,
} from "./errors.js";
// Network switching
export { ensureChain } from "./network.js";
