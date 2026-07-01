import { describe, expect, it } from "vitest";
import { cChain, chains, defineChain, fuji } from "./chains.js";

describe("chain registry", () => {
  it("fuji is a testnet with a faucet", () => {
    expect(fuji.id).toBe(43113);
    expect(fuji.testnet).toBe(true);
    expect(fuji.faucetUrl).toBeTypeOf("string");
  });

  it("c-chain is mainnet without a faucet", () => {
    expect(cChain.id).toBe(43114);
    expect(cChain.testnet).toBe(false);
    expect(cChain.faucetUrl).toBeUndefined();
  });

  it("defineChain returns the config unchanged", () => {
    const custom = defineChain({
      id: 99999,
      name: "My L1",
      rpcUrl: "https://example.invalid/rpc",
      explorerUrl: "https://example.invalid",
      nativeCurrency: { name: "Token", symbol: "TKN", decimals: 18 },
      testnet: true,
    });
    expect(custom.id).toBe(99999);
  });

  it("exposes builtin chains by slug", () => {
    expect(chains.fuji).toBe(fuji);
    expect(chains["c-chain"]).toBe(cChain);
  });
});
