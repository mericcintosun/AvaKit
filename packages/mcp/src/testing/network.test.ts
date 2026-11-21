import { cChain, fuji, getPublicClient, toViemChain } from "@avakit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeNetwork } from "./network.js";

const WALLET = "0x00000000000000000000000000000000000000aa";

// The fake network stands in for every RPC endpoint the server may use. When
// @avakit/core lists more than one endpoint for a chain, a request that fails
// on the first moves on to the next, and the failure a test set up has to be
// the answer there too, not a stray request that fails for its own reason.
describe("fakeNetwork", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("puts every endpoint core lists for a chain in front of that chain's one node", () => {
    const net = fakeNetwork();
    for (const [chain, node] of [
      [fuji, net.fuji],
      [cChain, net.cChain],
    ] as const) {
      expect(node.url).toBe(new URL(chain.rpcUrl).href);
      expect(node.urls[0]).toBe(node.url);
      expect(new Set(node.urls).size).toBe(node.urls.length);
      for (const url of toViemChain(chain).rpcUrls.default.http) {
        expect(node.urls).toContain(new URL(url).href);
      }
    }
  });

  it("answers with the failure a test set up at whichever endpoint a request reaches", async () => {
    const net = fakeNetwork();
    net.fuji.override("eth_getBalance", () => {
      throw { code: -32000, message: "header not found" };
    });
    await expect(getPublicClient(fuji).getBalance({ address: WALLET })).rejects.toThrow(
      "header not found",
    );
    expect(net.fuji.callsTo("eth_getBalance", net.fuji.url)).toHaveLength(1);
    for (const call of net.fuji.calls) expect(net.fuji.urls).toContain(call.url);
    expect(net.cChain.calls).toEqual([]);
    expect(net.strays).toEqual([]);
  });

  it("keeps a request to any other address inside the process, as a stray", async () => {
    const net = fakeNetwork();
    await expect(fetch("https://rpc.example/ext/bc/C/rpc", { method: "POST" })).rejects.toThrow(
      "fetch failed",
    );
    expect(net.strays).toEqual(["https://rpc.example/ext/bc/C/rpc"]);
  });
});
