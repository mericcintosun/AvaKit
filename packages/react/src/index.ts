"use client";

/**
 * @avakit/react
 *
 * React surface for AvaKit: <AvaKitProvider>, <ConnectAvalanche>, and hooks.
 * UI is shadcn-based (Radix + Tailwind tokens). See docs/07-spec-wallet-widget.md.
 *
 * The directive above must stay the first statement. This file is bundled into
 * one module, so it is what marks the whole published entry as a Client
 * Component boundary: everything exported here needs context, state or effects,
 * and without it a Next.js Server Component that imports anything from
 * "@avakit/react" crashes (createContext does not exist on the server).
 * `scripts/check-dist.mjs` fails the build if the bundle loses it.
 *
 * Server Components that only want the pure helpers (`cn`, `shortenAddress`,
 * `humanizeError`) import them from "@avakit/react/utils", which is built
 * without the directive so they stay callable on the server.
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
  type FaucetStatus,
  type TxStatus,
  useAvaAccount,
  useAvaChain,
  useAvaDeploy,
  useBalance,
  useContract,
  useFaucet,
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
export { cn, humanizeError, shortenAddress } from "./utils.js";
