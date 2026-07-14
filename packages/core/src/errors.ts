/**
 * Typed errors for AvaKit. Messages are action-oriented so both humans and AI
 * agents know what to do next (e.g. fund via the faucet, install a wallet).
 */

export class AvaKitError extends Error {
  override name = "AvaKitError";
}

export class WalletNotAvailableError extends AvaKitError {
  override name = "WalletNotAvailableError";
  constructor(adapterId: string) {
    super(
      `No wallet available for adapter "${adapterId}". Install a browser wallet (e.g. Core or MetaMask), or configure a social-login adapter.`,
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

export class MainnetConfirmationError extends AvaKitError {
  override name = "MainnetConfirmationError";
  constructor(chainName: string) {
    super(
      `Refusing to deploy to ${chainName} (mainnet) without explicit confirmation. ` +
        "Check the balance, then pass confirmMainnet: true — deploying here spends real funds.",
    );
  }
}

export class InsufficientFundsError extends AvaKitError {
  override name = "InsufficientFundsError";
  constructor(faucetUrl?: string) {
    super(
      faucetUrl
        ? `Insufficient AVAX for this transaction. Get testnet funds: ${faucetUrl}`
        : "Insufficient AVAX for this transaction.",
    );
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
