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

/**
 * Turn a wallet / RPC / viem error into one short, human-readable sentence.
 * Recognizes the common cases (rejected, no gas, missing approval, wrong chain);
 * otherwise falls back to viem's concise `shortMessage`, then the first line —
 * so a raw multi-paragraph dump never reaches the UI. Show the original behind a
 * "details" toggle if you want the full text.
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

  if (lower.includes("user rejected") || lower.includes("user denied") || lower.includes("4001"))
    return "You rejected the request in your wallet.";
  if (lower.includes("insufficient funds") || lower.includes("insufficient balance"))
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
