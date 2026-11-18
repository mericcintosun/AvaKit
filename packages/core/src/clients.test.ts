import { describe, expect, it } from "vitest";
import { defineChain, fuji } from "./chains.js";
import { toViemChain } from "./clients.js";

describe("toViemChain", () => {
  it("maps an AvaChain into the viem Chain shape", () => {
    const chain = toViemChain(fuji);
    expect(chain.id).toBe(fuji.id);
    expect(chain.name).toBe(fuji.name);
    expect(chain.rpcUrls.default.http[0]).toBe(fuji.rpcUrl);
    expect(chain.blockExplorers?.default.url).toBe(fuji.explorerUrl);
    expect(chain.testnet).toBe(true);
  });

  // viem's addChain turns blockExplorers into blockExplorerUrls, so an entry
  // with an empty URL would reach the wallet as [""] and be rejected.
  it("has no blockExplorers entry for a chain without an explorer", () => {
    const freshL1 = defineChain({
      id: 1001,
      name: "Fresh L1",
      rpcUrl: "http://127.0.0.1:9650/ext/bc/fresh/rpc",
      explorerUrl: "",
      nativeCurrency: { name: "Fresh", symbol: "FRSH", decimals: 18 },
      testnet: true,
    });
    const chain = toViemChain(freshL1);
    expect(chain.blockExplorers).toBeUndefined();
    expect(chain.rpcUrls.default.http[0]).toBe(freshL1.rpcUrl);
  });
});
