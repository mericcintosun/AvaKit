/**
 * @avakit/react
 *
 * React surface for AvaKit: <AvaKitProvider>, <ConnectAvalanche>, and hooks.
 * UI is shadcn-based (Radix + Tailwind tokens). See docs/07-spec-wallet-widget.md.
 */

export const VERSION = "0.1.1";

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
