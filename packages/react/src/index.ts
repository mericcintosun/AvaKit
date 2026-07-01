/**
 * @avakit/react
 *
 * React surface for AvaKit: <AvaKitProvider>, <ConnectAvalanche>, and hooks.
 * UI is shadcn-based (Radix + Tailwind tokens). See docs/07-spec-wallet-widget.md.
 */

export const VERSION = "0.1.0";

export { ConnectAvalanche, type ConnectAvalancheProps } from "./connect-avalanche.js";
export {
  type DeployStatus,
  useAvaAccount,
  useAvaChain,
  useAvaDeploy,
  useBalance,
  useContract,
} from "./hooks.js";
export {
  type AvaKitContextValue,
  AvaKitProvider,
  type AvaKitProviderProps,
  type ConnectionStatus,
  useAvaKit,
} from "./provider.js";

export { Button, buttonVariants } from "./ui.js";
export { cn, shortenAddress } from "./utils.js";
