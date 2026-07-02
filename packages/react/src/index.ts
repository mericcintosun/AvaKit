/**
 * @avakit/react
 *
 * React surface for AvaKit: <AvaKitProvider>, <ConnectAvalanche>, and hooks.
 * UI is shadcn-based (Radix + Tailwind tokens). See docs/07-spec-wallet-widget.md.
 */

// Injected at build time from package.json (single source of truth — it can
// never drift from the published version). The `typeof` guard keeps a bare
// `tsc`/`vitest` run working, where the tsup define isn't applied.
declare const __AVAKIT_VERSION__: string | undefined;
export const VERSION: string =
  typeof __AVAKIT_VERSION__ === "undefined" ? "0.0.0-dev" : __AVAKIT_VERSION__;

export type {
  DataTransaction,
  Erc20TokenBalance,
  Erc721TokenBalance,
  NativeTokenBalance,
} from "@avakit/core";
export { ConnectAvalanche, type ConnectAvalancheProps } from "./connect-avalanche.js";
export { useNfts, useTokenBalances, useTxHistory } from "./data-hooks.js";
export {
  type DeployStatus,
  type TxStatus,
  useAvaAccount,
  useAvaChain,
  useAvaDeploy,
  useBalance,
  useContract,
  useSendTransaction,
} from "./hooks.js";
export {
  type AvaKitContextValue,
  AvaKitProvider,
  type AvaKitProviderProps,
  type ConnectionStatus,
  useAvaKit,
} from "./provider.js";
export {
  TransactionButton,
  type TransactionButtonProps,
} from "./transaction-button.js";

export { Button, buttonVariants } from "./ui.js";
export { cn, shortenAddress } from "./utils.js";
