/**
 * Typed errors for AvaKit. Messages are action-oriented so both humans and AI
 * agents know what to do next (e.g. fund via the faucet, install a wallet).
 */

export class AvaKitError extends Error {
  override name = "AvaKitError";
}

export class WalletNotAvailableError extends AvaKitError {
  override name = "WalletNotAvailableError";
  /**
   * @param adapterId The adapter that cannot be used.
   * @param hint What to do about it. Defaults to the advice for a missing
   *   browser wallet; adapters with a different cause (for example an optional
   *   SDK that is not installed) pass their own.
   * @param options Standard error options, e.g. `{ cause }`.
   */
  constructor(adapterId: string, hint?: string, options?: ErrorOptions) {
    super(
      `No wallet available for adapter "${adapterId}". ${
        hint ??
        "Install a browser wallet (e.g. Core or MetaMask), or configure a social-login adapter."
      }`,
      options,
    );
  }
}

export class WalletConnectionError extends AvaKitError {
  override name = "WalletConnectionError";
}

export class ChainMismatchError extends AvaKitError {
  override name = "ChainMismatchError";
  constructor(expected: number, actual: number) {
    super(`Wrong network: expected chain ${expected} but the wallet is on chain ${actual}.`);
  }
}

export class DeployFailedError extends AvaKitError {
  override name = "DeployFailedError";
}

/**
 * A sentence to put in front of "this is a mainnet" errors when the chain never
 * said so itself: `isMainnet` treats a definition without a boolean `testnet`
 * flag as a mainnet, and the developer of a mis-defined testnet has to learn
 * what to fix before reading the refusal it causes. Ends with a space; empty for
 * a chain that carries the flag. (Internal: not part of the package's public
 * exports.)
 */
export function missingTestnetFlagHint(chain: { name?: string; testnet?: unknown }): string {
  return typeof chain.testnet === "boolean"
    ? ""
    : `${chain.name ?? "This chain"} has no boolean \`testnet\` flag in its definition, so it is ` +
        "treated as a mainnet (set testnet: true if it is a testnet). ";
}

export class MainnetConfirmationError extends AvaKitError {
  override name = "MainnetConfirmationError";
  /**
   * @param chainName Name of the chain the deployment was refused on.
   * @param why Optional sentence placed before the refusal, e.g. why the chain
   *   counts as a mainnet. Include its trailing space.
   */
  constructor(chainName: string, why = "") {
    super(
      `${why}Refusing to deploy to ${chainName} (mainnet) without explicit confirmation. ` +
        "Check the balance, then pass confirmMainnet: true — deploying here spends real funds.",
    );
  }
}

export class InsufficientFundsError extends AvaKitError {
  override name = "InsufficientFundsError";
  /**
   * @param faucetUrl Where to get testnet funds, when the chain has a faucet.
   * @param detail A specific description of the shortfall. Replaces the generic
   *   "Insufficient AVAX for this transaction." sentence.
   */
  constructor(faucetUrl?: string, detail?: string) {
    const what = detail ?? "Insufficient AVAX for this transaction.";
    super(faucetUrl ? `${what} Get testnet funds: ${faucetUrl}` : what);
  }
}

/**
 * Why a faucet request failed, for code to branch on:
 *
 * - `"rate_limited"`: this address, or this network, was funded recently (429).
 * - `"empty"`: the faucet has run out of funds (503, as the faucet's own answer).
 * - `"invalid"`: the request itself was refused, and sending it again will not
 *   help: a bad address, a chain the faucet does not serve, a missing or
 *   rejected captcha token (400 and every other 4xx).
 * - `"unavailable"`: the faucet failed on its side: it could not send the
 *   drip, is busy, misconfigured or down (500, 502 and every other 5xx).
 * - `"network"`: no answer arrived: the request could not be sent, timed out
 *   or was aborted.
 */
export type FaucetErrorCode = "rate_limited" | "empty" | "invalid" | "unavailable" | "network";

/** What a `FaucetError` knows beyond its message and HTTP status. */
export interface FaucetErrorDetails {
  /** Defaults to what `status` implies, or `"network"` when there is no status. */
  code?: FaucetErrorCode;
  /** How long the faucet asked the caller to wait, in milliseconds. */
  retryAfterMs?: number;
  /** The faucet's own refusal code, when its answer carried one. */
  faucetCode?: string;
  /** The underlying error, kept as the standard `cause`. */
  cause?: unknown;
}

/** The code a bare HTTP status stands for. No status means no answer arrived. */
function faucetCodeForStatus(status: number | undefined): FaucetErrorCode {
  if (status === undefined) return "network";
  if (status === 429) return "rate_limited";
  if (status === 503) return "empty";
  if (status >= 400 && status < 500) return "invalid";
  return "unavailable";
}

export class FaucetError extends AvaKitError {
  override name = "FaucetError";
  /** HTTP status of the faucet's answer. Undefined when no answer arrived. */
  readonly status?: number;
  /** What went wrong, for code to branch on. */
  readonly code: FaucetErrorCode;
  /**
   * Whether sending the same request again may work: true for `"unavailable"`
   * and `"network"`, false for a refusal (`"rate_limited"`, `"empty"`,
   * `"invalid"`). `requestFaucet` retries only these.
   */
  readonly retryable: boolean;
  /**
   * How long the faucet asked the caller to wait before trying again, in
   * milliseconds, taken from its `Retry-After` header. Undefined when it did not
   * say.
   */
  readonly retryAfterMs?: number;
  /**
   * The faucet's own refusal code, when its answer carried one (for example
   * `"address_limited"`, `"ip_limited"`, `"faucet_busy"` or
   * `"turnstile_required"` from the AvaKit faucet Worker). More specific than
   * `code`; undefined for a faucet that only sends a message.
   */
  readonly faucetCode?: string;

  /**
   * @param message What to tell the user: the faucet's own message when it sent one.
   * @param status HTTP status of the faucet's answer, if one arrived.
   * @param details The code and the rest. Without a `code`, the status decides.
   */
  constructor(message: string, status?: number, details: FaucetErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.status = status;
    this.code = details.code ?? faucetCodeForStatus(status);
    this.retryable = this.code === "unavailable" || this.code === "network";
    this.retryAfterMs = details.retryAfterMs;
    this.faucetCode = details.faucetCode;
  }
}
