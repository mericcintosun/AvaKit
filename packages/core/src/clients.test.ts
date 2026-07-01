import { describe, expect, it } from "vitest";
import { fuji } from "./chains.js";
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
});
