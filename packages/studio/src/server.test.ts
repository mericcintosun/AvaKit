import { describe, expect, it } from "vitest";
import { safeTokenEqual } from "./server.js";

describe("safeTokenEqual (A19)", () => {
  it("matches only the exact token", () => {
    expect(safeTokenEqual("abc123def", "abc123def")).toBe(true);
  });

  it("rejects wrong, different-length, array, and undefined inputs", () => {
    expect(safeTokenEqual("abc123deg", "abc123def")).toBe(false);
    expect(safeTokenEqual("abc", "abc123def")).toBe(false);
    expect(safeTokenEqual(["abc123def"], "abc123def")).toBe(false);
    expect(safeTokenEqual(undefined, "abc123def")).toBe(false);
  });
});
