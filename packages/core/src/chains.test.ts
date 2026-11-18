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

  it("allows a blank explorerUrl/faucetUrl (a fresh L1 has neither yet)", () => {
    expect(() => defineChain({ ...base, explorerUrl: "" })).not.toThrow();
    expect(() => defineChain({ ...base, faucetUrl: "" })).not.toThrow();
    expect(() => defineChain({ ...base, faucetUrl: undefined })).not.toThrow();
  });
});

// Checked with HTTP requests on 2026-11-18: these bases answer `/tx/<hash>` and
// `/address/<address>` with a 200 and no redirect. The hosts they replace
// (subnets-test.avax.network, subnets.avax.network, core.app's faucet page) only
// redirect to them.
describe("built-in chain links", () => {
  it("points both networks straight at the Builder Hub explorer", () => {
    expect(fuji.explorerUrl).toBe("https://build.avax.network/explorer/fuji/c-chain");
    expect(cChain.explorerUrl).toBe("https://build.avax.network/explorer/mainnet/c-chain");
  });

  it("keeps each network on its own explorer", () => {
    expect(fuji.explorerUrl).not.toBe(cChain.explorerUrl);
    expect(new URL(fuji.explorerUrl).pathname).toContain("/fuji/");
    expect(new URL(cChain.explorerUrl).pathname).toContain("/mainnet/");
  });

  // Callers append "/tx/…" and "/address/…", so a trailing slash would produce
  // "//tx/…".
  it("has no trailing slash, so appended paths keep a single separator", () => {
    for (const chain of [fuji, cChain]) {
      expect(chain.explorerUrl.endsWith("/")).toBe(false);
      expect(new URL(`${chain.explorerUrl}/tx/0xabc`).pathname).toBe(
        `${new URL(chain.explorerUrl).pathname}/tx/0xabc`,
      );
    }
  });

  it("sends people to the Builder Hub faucet on Fuji, and offers none on mainnet", () => {
    expect(fuji.faucetUrl).toBe("https://build.avax.network/console/primary-network/faucet");
    expect(cChain.faucetUrl).toBeUndefined();
  });

  it("uses none of the hosts that only redirect", () => {
    const hosts = [fuji.explorerUrl, cChain.explorerUrl, fuji.faucetUrl ?? ""].map(
      (url) => new URL(url).host,
    );
    expect(hosts).toEqual(["build.avax.network", "build.avax.network", "build.avax.network"]);
  });
});

describe("isMainnet (A9)", () => {
  it("treats a known mainnet id as mainnet", () => {
    expect(isMainnet(cChain)).toBe(true);
    expect(KNOWN_MAINNET_CHAIN_IDS.has(43114)).toBe(true);
  });

  it("treats testnets as non-mainnet", () => {
    expect(isMainnet(fuji)).toBe(false);
    expect(isMainnet({ ...base, testnet: true })).toBe(false);
  });

  it("treats a chain that says testnet: false as mainnet", () => {
    expect(isMainnet({ ...base, testnet: false })).toBe(true);
  });

  // The type requires the flag, but plain JavaScript or a JSON config can leave
  // it out. That used to read as "testnet", skipping the deploy confirmation and
  // letting the burner wallet in; it has to fail closed instead.
  it("treats a chain that never says testnet: true as mainnet", () => {
    const noFlag = { ...base, testnet: undefined } as unknown as AvaChain;
    const { testnet: _omitted, ...withoutFlag } = base;
    const stringFlag = { ...base, testnet: "true" } as unknown as AvaChain;

    expect(isMainnet(noFlag)).toBe(true);
    expect(isMainnet(withoutFlag as AvaChain)).toBe(true);
    expect(isMainnet(stringFlag)).toBe(true);
  });

  it("refuses to define a known mainnet id as a testnet", () => {
    expect(() => defineChain({ ...base, id: 43114, testnet: true })).toThrow(/known mainnet/);
  });
});
