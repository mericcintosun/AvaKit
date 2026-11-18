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
  message?: unknown;
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
 * What AvaKit's own wallet said when it refused a request: a
 * `WalletConnectionError` from @avakit/core, recognized by name. The temporary
 * wallet refuses a transaction this way when, for one, its chain's RPC turns
 * out to serve another chain. Sent through a viem wallet client, such a refusal
 * arrives wrapped in "An unknown RPC error occurred.", which tells the user
 * nothing, while the refusal itself is written for them.
 */
function walletRefusal(chain: ErrorLink[]): string | undefined {
  const link = chain.find((candidate) => candidate.name === "WalletConnectionError");
  return typeof link?.message === "string" ? link.message : undefined;
}

/** The longest text returned for an error that is not one of the recognized cases. */
const MAX_LENGTH = 200;

/**
 * The first line of `text`, at most `MAX_LENGTH` characters of it. A longer line
 * ends with its last complete sentence inside the limit, so that the text does
 * not stop in the middle of a word, unless that would drop more than half of
 * what fits: then it is cut at the limit, as before.
 */
function firstLine(text: string): string {
  const line = text.split("\n")[0] ?? text;
  if (line.length <= MAX_LENGTH) {
    return line;
  }
  const cut = line.slice(0, MAX_LENGTH);
  const sentenceEnd = cut.lastIndexOf(". ");
  return sentenceEnd + 1 >= MAX_LENGTH / 2 ? cut.slice(0, sentenceEnd + 1) : cut;
}

/**
 * Turn a wallet / RPC / viem error into one short, human-readable sentence.
 * Recognizes the common cases (rejected, no gas, missing approval, wrong chain);
 * otherwise falls back to what AvaKit's own wallet said when it refused, then to
 * viem's concise `shortMessage`, then the first line — so a raw multi-paragraph
 * dump never reaches the UI. Show the original behind a "details" toggle if you
 * want the full text.
 *
 * Rejections and missing gas are recognized by the error's `code` / `name`
 * anywhere in its cause chain first, and by wording second.
 */
export function humanizeError(error: unknown): string {
  const chain = causeChain(error);
  const raw =
    walletRefusal(chain) ??
    (typeof error === "object" && error !== null
      ? ((error as { shortMessage?: string }).shortMessage ??
        (error as { message?: string }).message ??
        String(error))
      : String(error));
  const text = String(raw);
  const lower = text.toLowerCase();

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

  return firstLine(text);
}
