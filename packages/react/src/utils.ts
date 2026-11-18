import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className combiner (shadcn convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Truncate an address as 0x1234…abcd. */
export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}

/** A link of an error's `cause` chain, read structurally (no library types needed). */
interface ErrorLink {
  name?: unknown;
  code?: unknown;
  details?: unknown;
  cause?: unknown;
}

/**
 * The error followed by its causes. viem wraps what the wallet or node said in
 * its own errors, so the telling `code` or `name` usually sits a level or two
 * down. Bounded, in case a cause chain loops.
 */
function causeChain(error: unknown): ErrorLink[] {
  const links: ErrorLink[] = [];
  let current = error;
  while (typeof current === "object" && current !== null && links.length < 10) {
    links.push(current as ErrorLink);
    current = (current as ErrorLink).cause;
  }
  return links;
}

/** EIP-1193 code 4001 (also what viem's UserRejectedRequestError carries), or ethers' flag. */
function isUserRejection(link: ErrorLink): boolean {
  return (
    link.code === 4001 ||
    link.code === "ACTION_REJECTED" ||
    link.name === "UserRejectedRequestError"
  );
}

/** What nodes say when the sender cannot cover gas plus value. */
const NODE_INSUFFICIENT_FUNDS = /insufficient funds|exceeds transaction sender account balance/i;

/**
 * viem's (and AvaKit's) InsufficientFundsError, or the node's own wording kept
 * in `details`. viem's short message for this case does not contain the words
 * "insufficient funds" at all, so the text alone is not enough.
 */
function isInsufficientFunds(link: ErrorLink): boolean {
  return (
    link.name === "InsufficientFundsError" ||
    (typeof link.details === "string" && NODE_INSUFFICIENT_FUNDS.test(link.details))
  );
}

/**
 * Turn a wallet / RPC / viem error into one short, human-readable sentence.
 * Recognizes the common cases (rejected, no gas, missing approval, wrong chain);
 * otherwise falls back to viem's concise `shortMessage`, then the first line —
 * so a raw multi-paragraph dump never reaches the UI. Show the original behind a
 * "details" toggle if you want the full text.
 *
 * Rejections and missing gas are recognized by the error's `code` / `name`
 * anywhere in its cause chain first, and by wording second.
 */
export function humanizeError(error: unknown): string {
  const raw =
    typeof error === "object" && error !== null
      ? ((error as { shortMessage?: string }).shortMessage ??
        (error as { message?: string }).message ??
        String(error))
      : String(error);
  const text = String(raw);
  const lower = text.toLowerCase();
  const chain = causeChain(error);

  // Matched on the code, never on a bare "4001" in the text: that number also
  // turns up in ports, amounts and hex data.
  if (
    chain.some(isUserRejection) ||
    lower.includes("user rejected") ||
    lower.includes("user denied")
  )
    return "You rejected the request in your wallet.";
  if (
    chain.some(isInsufficientFunds) ||
    lower.includes("insufficient funds") ||
    lower.includes("insufficient balance") ||
    lower.includes("exceeds the balance of the account")
  )
    return "Not enough native balance to cover gas. Fund this wallet and try again.";
  if (lower.includes("insufficientallowance") || lower.includes("insufficient allowance"))
    return "Token allowance is too low — approve the token first, then retry.";
  if (
    lower.includes("chain mismatch") ||
    lower.includes("wrong network") ||
    lower.includes("does not match the target chain")
  )
    return "Your wallet is on the wrong network — switch to this app's chain and try again.";
  if (lower.includes("nonce"))
    return "Transaction nonce issue — reset your wallet's activity (or try again in a moment).";

  return (text.split("\n")[0] ?? text).slice(0, 200);
}
