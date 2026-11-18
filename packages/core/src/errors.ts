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

export class FaucetError extends AvaKitError {
  override name = "FaucetError";
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}
