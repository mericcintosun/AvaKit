import { describe, expect, it } from "vitest";
import {
  type AvaChain,
  cChain,
  defineChain,
  fuji,
  isMainnet,
  KNOWN_MAINNET_CHAIN_IDS,
} from "./chains.js";

const base: AvaChain = {
  id: 999,
  name: "Test L1",
  rpcUrl: "https://rpc.example.com",
  explorerUrl: "https://explorer.example.com",
  nativeCurrency: { name: "Test", symbol: "TST", decimals: 18 },
  testnet: true,
};

describe("defineChain URL validation (A17)", () => {
  it("accepts http(s) URLs", () => {
    expect(() => defineChain({ ...base, rpcUrl: "http://localhost:8545" })).not.toThrow();
    expect(() => defineChain({ ...base })).not.toThrow();
  });

  it("rejects non-http(s) schemes and malformed URLs", () => {
    expect(() => defineChain({ ...base, rpcUrl: "javascript:alert(1)" })).toThrow(/rpcUrl/);
    expect(() => defineChain({ ...base, rpcUrl: "file:///etc/passwd" })).toThrow(/rpcUrl/);
    expect(() => defineChain({ ...base, explorerUrl: "not a url" })).toThrow(/explorerUrl/);
    expect(() => defineChain({ ...base, faucetUrl: "ftp://x" })).toThrow(/faucetUrl/);
  });
});

describe("isMainnet (A9)", () => {
  it("treats a known mainnet id as mainnet", () => {
    expect(isMainnet(cChain)).toBe(true);
    expect(KNOWN_MAINNET_CHAIN_IDS.has(43114)).toBe(true);
  });

  it("treats testnets as non-mainnet", () => {
    expect(isMainnet(fuji)).toBe(false);
  });

  it("refuses to define a known mainnet id as a testnet", () => {
    expect(() => defineChain({ ...base, id: 43114, testnet: true })).toThrow(/known mainnet/);
  });
});
