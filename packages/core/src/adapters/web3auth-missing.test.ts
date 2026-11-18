import { describe, expect, it, vi } from "vitest";
import { WalletNotAvailableError } from "../errors.js";
import { web3authAdapter } from "./web3auth.js";

// In this file the optional `@web3auth/modal` package cannot be loaded at all,
// as in an app that uses the adapter without installing it.
vi.mock("@web3auth/modal", () => {
  throw new Error("Cannot find package '@web3auth/modal'");
});

describe("web3authAdapter without @web3auth/modal", () => {
  it("names the missing package instead of advising a browser wallet", async () => {
    const connecting = web3authAdapter({ clientId: "test-client-id" }).connect();

    await expect(connecting).rejects.toBeInstanceOf(WalletNotAvailableError);
    await expect(connecting).rejects.toThrow("npm install @web3auth/modal");
    await expect(connecting).rejects.not.toThrow(/Install a browser wallet/);
    await expect(connecting).rejects.toHaveProperty("cause");
  });

  it("fails the same way on every attempt", async () => {
    const adapter = web3authAdapter({ clientId: "test-client-id" });

    await expect(adapter.connect()).rejects.toBeInstanceOf(WalletNotAvailableError);
    await expect(adapter.connect()).rejects.toBeInstanceOf(WalletNotAvailableError);
  });
});
