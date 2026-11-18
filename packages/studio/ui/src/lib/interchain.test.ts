import { describe, expect, it } from "vitest";
import {
  hasArrived,
  messageBytes,
  messageProblem,
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
