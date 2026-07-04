import { describe, expect, it } from "vitest";
import {
  AvaKitError,
  ChainMismatchError,
  DeployFailedError,
  InsufficientFundsError,
  MainnetConfirmationError,
  WalletConnectionError,
  WalletNotAvailableError,
} from "./errors.js";

describe("errors", () => {
  it("all subclasses extend AvaKitError and carry their own name", () => {
    for (const err of [
      new DeployFailedError("boom"),
      new WalletConnectionError("boom"),
      new ChainMismatchError(43113, 1),
      new InsufficientFundsError(),
      new MainnetConfirmationError("Avalanche C-Chain"),
      new WalletNotAvailableError("web3auth"),
    ]) {
      expect(err).toBeInstanceOf(AvaKitError);
      expect(err.name).toBe(err.constructor.name);
    }
  });

  it("InsufficientFundsError includes the faucet URL only when given", () => {
    expect(new InsufficientFundsError("https://faucet.example").message).toContain(
      "https://faucet.example",
    );
    expect(new InsufficientFundsError().message).not.toContain("http");
  });

  it("ChainMismatchError names both the expected and actual chains", () => {
    const e = new ChainMismatchError(43113, 1);
    expect(e.message).toContain("43113");
    expect(e.message).toContain("1");
  });

  it("MainnetConfirmationError names the chain and points at confirmMainnet", () => {
    const e = new MainnetConfirmationError("Avalanche C-Chain");
    expect(e.message).toContain("Avalanche C-Chain");
    expect(e.message).toContain("confirmMainnet");
  });

  it("WalletNotAvailableError references the adapter id", () => {
    expect(new WalletNotAvailableError("web3auth").message).toContain("web3auth");
  });
});
