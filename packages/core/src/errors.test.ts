import { describe, expect, it } from "vitest";
import {
  AvaKitError,
  ChainMismatchError,
  DeployFailedError,
  FaucetError,
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
      new FaucetError("boom"),
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

  // The two-argument form is what existed before the code: it has to keep
  // working, and to mean what the status says.
  it("FaucetError works out its code from the status when given no code", () => {
    expect(new FaucetError("Rate limited.", 429)).toMatchObject({
      message: "Rate limited.",
      status: 429,
      code: "rate_limited",
      retryable: false,
    });
    expect(new FaucetError("Empty.", 503)).toMatchObject({ code: "empty", retryable: false });
    expect(new FaucetError("Bad address.", 400)).toMatchObject({
      code: "invalid",
      retryable: false,
    });
    expect(new FaucetError("Forbidden.", 403)).toMatchObject({ code: "invalid", retryable: false });
    expect(new FaucetError("Send failed.", 502)).toMatchObject({
      code: "unavailable",
      retryable: true,
    });
    expect(new FaucetError("Not configured.", 500)).toMatchObject({
      code: "unavailable",
      retryable: true,
    });
  });

  it("FaucetError without a status is a request that got no answer", () => {
    const e = new FaucetError("Faucet request failed: Failed to fetch");

    expect(e.status).toBeUndefined();
    expect(e.code).toBe("network");
    expect(e.retryable).toBe(true);
    expect(e.retryAfterMs).toBeUndefined();
    expect(e.faucetCode).toBeUndefined();
  });

  it("FaucetError lets an explicit code overrule the status, and keeps the details", () => {
    const cause = new Error("upstream");
    const busy = new FaucetError("Busy.", 503, {
      code: "unavailable",
      faucetCode: "faucet_busy",
      retryAfterMs: 3000,
      cause,
    });

    expect(busy.code).toBe("unavailable");
    expect(busy.retryable).toBe(true);
    expect(busy.status).toBe(503);
    expect(busy.faucetCode).toBe("faucet_busy");
    expect(busy.retryAfterMs).toBe(3000);
    expect(busy.cause).toBe(cause);
  });

  it("FaucetError is retryable for exactly the failures that may pass", () => {
    const retryable = (
      ["rate_limited", "empty", "paused", "invalid", "unavailable", "network"] as const
    ).map((code) => [code, new FaucetError("x", undefined, { code }).retryable]);

    expect(retryable).toEqual([
      ["rate_limited", false],
      ["empty", false],
      ["paused", false],
      ["invalid", false],
      ["unavailable", true],
      ["network", true],
    ]);
  });

  // A pause and an empty faucet both answer 503, so "paused" has to be said:
  // the status alone still reads as "empty", as it does from an older faucet.
  it("FaucetError is paused only when it is told so", () => {
    expect(new FaucetError("Paused.", 503)).toMatchObject({ code: "empty" });
    expect(
      new FaucetError("Paused.", 503, { code: "paused", faucetCode: "faucet_paused" }),
    ).toMatchObject({ code: "paused", retryable: false, status: 503, faucetCode: "faucet_paused" });
  });

  it("WalletNotAvailableError advises a browser wallet unless given a specific hint", () => {
    expect(new WalletNotAvailableError("injected").message).toContain("Install a browser wallet");

    const cause = new Error("Cannot find package");
    const specific = new WalletNotAvailableError("coinbase", "Install the SDK.", { cause });
    expect(specific.message).toBe('No wallet available for adapter "coinbase". Install the SDK.');
    expect(specific.cause).toBe(cause);
  });
});
