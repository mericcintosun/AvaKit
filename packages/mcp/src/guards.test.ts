import { cChain, fuji } from "@avakit/core";
import { afterEach, describe, expect, it } from "vitest";
import { assertMainnetAllowed } from "./guards.js";

describe("assertMainnetAllowed", () => {
  const original = process.env.AVAKIT_ALLOW_MAINNET;
  afterEach(() => {
    if (original === undefined) delete process.env.AVAKIT_ALLOW_MAINNET;
    else process.env.AVAKIT_ALLOW_MAINNET = original;
  });

  it("allows any testnet deploy regardless of confirm or env", () => {
    delete process.env.AVAKIT_ALLOW_MAINNET;
    expect(() => assertMainnetAllowed(fuji, undefined)).not.toThrow();
    expect(() => assertMainnetAllowed(fuji, false)).not.toThrow();
  });

  it("rejects mainnet without confirm", () => {
    process.env.AVAKIT_ALLOW_MAINNET = "1";
    expect(() => assertMainnetAllowed(cChain, undefined)).toThrow(/without confirm/);
    expect(() => assertMainnetAllowed(cChain, false)).toThrow(/without confirm/);
  });

  it("rejects mainnet with confirm but no env opt-in (prompt cannot set env)", () => {
    delete process.env.AVAKIT_ALLOW_MAINNET;
    expect(() => assertMainnetAllowed(cChain, true)).toThrow(/AVAKIT_ALLOW_MAINNET/);
  });

  it("allows mainnet only with BOTH confirm and the env opt-in", () => {
    process.env.AVAKIT_ALLOW_MAINNET = "1";
    expect(() => assertMainnetAllowed(cChain, true)).not.toThrow();
  });
});
