import { describe, expect, it } from "vitest";
import {
  countPeers,
  DELIVERY_TIMEOUT_MS,
  devnetBanner,
  hasArrived,
  interchainCard,
  interchainStage,
  messageBytes,
  messageProblem,
  overdueIn,
  resolvePair,
  withFrom,
  withTo,
} from "./interchain";

describe("resolvePair", () => {
  it("needs two chains", () => {
    expect(resolvePair([])).toBeNull();
    expect(resolvePair(["chain1"])).toBeNull();
  });

  it("defaults to the first two chains", () => {
    expect(resolvePair(["chain1", "chain2"])).toEqual({ from: "chain1", to: "chain2" });
    expect(resolvePair(["alpha", "chain1", "chain2"])).toEqual({ from: "alpha", to: "chain1" });
  });

  it("keeps the user's pick among three chains", () => {
    const names = ["alpha", "chain1", "chain2"];
    expect(resolvePair(names, { from: "chain1", to: "chain2" })).toEqual({
      from: "chain1",
      to: "chain2",
    });
    expect(resolvePair(names, { from: "chain2", to: "alpha" })).toEqual({
      from: "chain2",
      to: "alpha",
    });
  });

  it("repairs a pick that no longer exists or sends a chain to itself", () => {
    const names = ["chain1", "chain2"];
    expect(resolvePair(names, { from: "gone", to: "chain1" })).toEqual({
      from: "chain1",
      to: "chain2",
    });
    expect(resolvePair(names, { from: "chain2", to: "gone" })).toEqual({
      from: "chain2",
      to: "chain1",
    });
    expect(resolvePair(names, { from: "chain2", to: "chain2" })).toEqual({
      from: "chain2",
      to: "chain1",
    });
  });
});

describe("withFrom / withTo", () => {
  const pair = { from: "chain1", to: "chain2" };

  it("changes one end and leaves the other", () => {
    expect(withFrom(pair, "alpha")).toEqual({ from: "alpha", to: "chain2" });
    expect(withTo(pair, "alpha")).toEqual({ from: "chain1", to: "alpha" });
  });

  it("swaps when the other end is picked", () => {
    expect(withFrom(pair, "chain2")).toEqual({ from: "chain2", to: "chain1" });
    expect(withTo(pair, "chain1")).toEqual({ from: "chain2", to: "chain1" });
  });
});

describe("messageProblem", () => {
  it("accepts text up to the byte limit", () => {
    expect(messageProblem("gm from the other chain", 256)).toBeNull();
    expect(messageProblem("a".repeat(256), 256)).toBeNull();
  });

  it("counts UTF-8 bytes, not characters", () => {
    expect(messageBytes("gm")).toBe(2);
    expect(messageBytes("山")).toBe(3);
    expect(messageBytes("🔺")).toBe(4);
    expect(messageProblem("山".repeat(85), 256)).toBeNull();
    expect(messageProblem("山".repeat(86), 256)).toMatch(/258 of 256 bytes/);
    expect(messageProblem("a".repeat(257), 256)).toMatch(/257 of 256 bytes/);
  });

  it("refuses an empty message and a leading dash", () => {
    expect(messageProblem("", 256)).toMatch(/Type a message/);
    expect(messageProblem("--help", 256)).toMatch(/can't start with/);
  });
});

describe("overdueIn", () => {
  it("counts down from the delivery timeout and stops at zero", () => {
    const sentAt = 1_700_000_000_000;
    expect(overdueIn(sentAt, sentAt)).toBe(DELIVERY_TIMEOUT_MS);
    expect(overdueIn(sentAt, sentAt + 12_000)).toBe(DELIVERY_TIMEOUT_MS - 12_000);
    expect(overdueIn(sentAt, sentAt + DELIVERY_TIMEOUT_MS)).toBe(0);
    // Long overdue (a tab that slept), or a clock that went backwards: never negative.
    expect(overdueIn(sentAt, sentAt + 10 * DELIVERY_TIMEOUT_MS)).toBe(0);
    expect(overdueIn(sentAt, sentAt - 5_000)).toBe(DELIVERY_TIMEOUT_MS + 5_000);
  });
});

describe("hasArrived", () => {
  const sent = { message: "gm", receivedBefore: 3 };

  it("is not fooled by the same text having been delivered before", () => {
    // Re-sending "gm": the destination already shows "gm" from last time.
    expect(hasArrived(sent, { lastMessage: "gm", messagesReceived: 3 })).toBe(false);
    expect(hasArrived(sent, { lastMessage: "gm", messagesReceived: 4 })).toBe(true);
  });

  it("needs the text to match too", () => {
    expect(hasArrived(sent, { lastMessage: "something else", messagesReceived: 4 })).toBe(false);
    expect(hasArrived(sent, { lastMessage: null, messagesReceived: null })).toBe(false);
  });

  it("falls back to the text when no count is available", () => {
    expect(
      hasArrived(
        { message: "gm", receivedBefore: null },
        { lastMessage: "gm", messagesReceived: 9 },
      ),
    ).toBe(true);
    expect(hasArrived(sent, { lastMessage: "gm", messagesReceived: null })).toBe(true);
  });
});

describe("what the Overview card and the Devnet banner say about Interchain", () => {
  const l1 = (running: boolean, teleporterReady = true) => ({ running, teleporterReady });

  it("counts only running L1s that have Teleporter", () => {
    expect(countPeers([])).toBe(0);
    expect(countPeers([l1(true), l1(true), l1(false), l1(true, false)])).toBe(2);
  });

  it("is ready only on the server's word, never because two L1s are running", () => {
    // Three running L1s and no messenger anywhere: this used to read "Ready / LIVE".
    expect(interchainStage(3, { ready: false })).toBe("needs-messengers");
    expect(interchainStage(2, { ready: true })).toBe("ready");
    // Not known yet is not ready either.
    expect(interchainStage(2, null)).toBe("checking");
    // Fewer than two L1s: nothing to send between, whatever an old answer said.
    expect(interchainStage(1, { ready: true })).toBe("no-peers");
    expect(interchainStage(0, null)).toBe("no-peers");
  });

  it("shows the Overview card as live only when a message can be sent", () => {
    expect(interchainCard("ready")).toEqual({
      value: "Ready",
      live: true,
      sub: "send a cross-chain message",
    });
    expect(interchainCard("needs-messengers")).toEqual({
      value: "Set up",
      live: false,
      sub: "deploy the messengers to send a message",
    });
    expect(interchainCard("checking")).toMatchObject({ live: false });
    expect(interchainCard("no-peers")).toEqual({
      value: "—",
      live: false,
      sub: "needs 2 running L1s",
    });
    for (const stage of ["needs-messengers", "checking", "no-peers"] as const) {
      expect(interchainCard(stage).value, stage).not.toBe("Ready");
    }
  });

  it("words the Devnet banner by what is still to do", () => {
    expect(devnetBanner("ready", 2)).toEqual({
      detail: "Two L1s with a relayer — ready for a cross-chain message.",
      action: "Send a message",
    });
    expect(devnetBanner("needs-messengers", 3)).toEqual({
      detail: "3 L1s with a relayer — deploy the messengers to send a message.",
      action: "Deploy messengers",
    });
    expect(devnetBanner("checking", 2)?.detail).toBe("Two L1s with a relayer.");
    expect(devnetBanner("no-peers", 1)).toBeNull();
  });
});
