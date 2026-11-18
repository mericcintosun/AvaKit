import { describe, expect, it } from "vitest";
import {
  AvaKitError,
  ChainMismatchError,
  DeployFailedError,
  InsufficientFundsError,
  MainnetConfirmationError,
  missingTestnetFlagHint,
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

  it("InsufficientFundsError describes a specific shortfall when given one", () => {
    expect(new InsufficientFundsError().message).toBe("Insufficient AVAX for this transaction.");
    expect(new InsufficientFundsError(undefined, "0x1 holds 0 TKN.").message).toBe(
      "0x1 holds 0 TKN.",
    );
    expect(new InsufficientFundsError("https://faucet.example", "0x1 holds 0 TKN.").message).toBe(
      "0x1 holds 0 TKN. Get testnet funds: https://faucet.example",
    );
  });

  it("explains the mainnet verdict only for a chain that carries no testnet flag", () => {
    expect(missingTestnetFlagHint({ name: "My L1", testnet: true })).toBe("");
    expect(missingTestnetFlagHint({ name: "My L1", testnet: false })).toBe("");
    expect(missingTestnetFlagHint({ name: "My L1" })).toContain("testnet: true");
    expect(missingTestnetFlagHint({ name: "My L1", testnet: "true" })).toContain("My L1");

    const refused = new MainnetConfirmationError(
      "My L1",
      missingTestnetFlagHint({ name: "My L1" }),
    );
    expect(refused.message).toContain("confirmMainnet");
    expect(refused.message).toContain("no boolean `testnet` flag");
    // The cause comes first, so it survives UIs that only show the start of a message.
    expect(refused.message.indexOf("no boolean")).toBeLessThan(
      refused.message.indexOf("Refusing to deploy"),
    );
    expect(refused.message.slice(0, 200)).toContain("set testnet: true");
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

  it("WalletNotAvailableError advises a browser wallet unless given a specific hint", () => {
    expect(new WalletNotAvailableError("injected").message).toContain("Install a browser wallet");

    const cause = new Error("Cannot find package");
    const specific = new WalletNotAvailableError("coinbase", "Install the SDK.", { cause });
    expect(specific.message).toBe('No wallet available for adapter "coinbase". Install the SDK.');
    expect(specific.cause).toBe(cause);
  });
});
