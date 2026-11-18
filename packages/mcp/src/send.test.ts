import { cChain, fuji } from "@avakit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { send } from "./send.js";
import { type FakeNetwork, fakeClock, fakeNetwork } from "./testing/network.js";
import { resolveSigner } from "./wallet.js";

// `send` through the tools is covered in deploy.test.ts, write.test.ts and
// session.test.ts. This file holds what the tools cannot reach: a caller that
// pairs a signer with a chain it was not resolved for.

let net: FakeNetwork;
beforeEach(() => {
  net = fakeNetwork();
  fakeClock();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("send", () => {
  it("never asks the faucet for the session wallet on a chain other than Fuji", async () => {
    // The session wallet as the tools get it: for Fuji, with no key configured.
    const signer = resolveSigner(fuji, {});
    expect(signer.source).toBe("session");

    await expect(
      send(cChain, signer, {
        kind: "transaction",
        to: "0x00000000000000000000000000000000000000c1",
        data: "0x1249c58b",
      }),
    ).rejects.toThrow(
      "The session test wallet is funded and used on Avalanche Fuji (chain 43113) only, not on " +
        "Avalanche C-Chain. Nothing was sent.",
    );
    // Refused where the faucet would have been asked: before any request to it,
    // and before anything was signed.
    expect(net.faucet.requests).toEqual([]);
    expect(net.cChain.sent).toEqual([]);
    expect(net.fuji.calls).toEqual([]);
    expect(net.strays).toEqual([]);
  });
});
