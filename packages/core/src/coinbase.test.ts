import { afterEach, describe, expect, it, vi } from "vitest";
import { coinbaseAdapter } from "./coinbase.js";
import { WalletNotAvailableError } from "./errors.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("coinbaseAdapter", () => {
  it("has a stable id and a passkey label", () => {
    const adapter = coinbaseAdapter();
    expect(adapter.id).toBe("coinbase");
    expect(adapter.name).toMatch(/passkey/i);
  });

  it("is unavailable without a browser (no window)", () => {
    expect(coinbaseAdapter().isAvailable()).toBe(false);
  });

  it("is available in a browser-like environment", () => {
    vi.stubGlobal("window", {});
    expect(coinbaseAdapter().isAvailable()).toBe(true);
  });

  it("throws a typed error when @coinbase/wallet-sdk is not installed", async () => {
    await expect(coinbaseAdapter().connect()).rejects.toBeInstanceOf(WalletNotAvailableError);
  });
});
