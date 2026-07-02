/**
 * @avakit/core
 *
 * Framework-agnostic kernel for AvaKit. Depends only on viem. React-specific
 * code lives in `@avakit/react`. See docs/06-spec-core-sdk.md.
 *
 * M1: chain registry, viem clients, wallet adapters (injected + Web3Auth),
 * deploy helper, and read-only chain data.
 */

// Injected at build time from package.json (single source of truth — it can
// never drift from the published version). The `typeof` guard keeps a bare
// `tsc`/`vitest` run working, where the tsup define isn't applied.
declare const __AVAKIT_VERSION__: string | undefined;
export const VERSION: string =
  typeof __AVAKIT_VERSION__ === "undefined" ? "0.0.0-dev" : __AVAKIT_VERSION__;

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
// Data (RPC)
export { getBalance, getTransactionReceipt, readContract } from "./data.js";
// Data API (AvaCloud / Glacier — indexed balances, NFTs, tx history)
export {
  DATA_API_BASE_URL,
  DataApiError,
  type DataApiOptions,
  type DataTransaction,
  type Erc20BalancesResponse,
  type Erc20TokenBalance,
  type Erc721BalancesResponse,
  type Erc721TokenBalance,
  getNativeBalance,
  listErc20Balances,
  listNfts,
  listTransactions,
  type NativeBalanceResponse,
  type NativeTokenBalance,
  type TransactionsResponse,
} from "./data-api.js";
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
