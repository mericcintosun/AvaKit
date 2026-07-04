import { describe, expect, it } from "vitest";
import { cn, humanizeError, shortenAddress } from "./utils.js";

describe("cn", () => {
  it("merges class names and resolves Tailwind conflicts (last wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", false, undefined, "font-bold")).toBe("text-sm font-bold");
  });
});

describe("shortenAddress", () => {
  const addr = "0x000000000000000000000000000000000000dEaD";
  it("truncates to 0x + 4 + … + 4 by default", () => {
    expect(shortenAddress(addr)).toBe("0x0000…dEaD");
  });
  it("respects a custom char count", () => {
    expect(shortenAddress(addr, 6)).toBe("0x000000…00dEaD");
  });
});

describe("humanizeError", () => {
  it("prefers viem's shortMessage over message", () => {
    expect(
      humanizeError({ shortMessage: "User rejected the request.", message: "long dump" }),
    ).toBe("You rejected the request in your wallet.");
  });

  it("recognizes user rejection (including code 4001)", () => {
    expect(humanizeError(new Error("User denied transaction signature (4001)"))).toBe(
      "You rejected the request in your wallet.",
    );
  });

  it("recognizes insufficient funds", () => {
    expect(humanizeError(new Error("insufficient funds for gas"))).toContain("Fund this wallet");
  });

  it("recognizes a low token allowance", () => {
    expect(humanizeError(new Error("ERC20: insufficient allowance"))).toContain(
      "approve the token",
    );
  });

  it("recognizes a wrong-network / chain mismatch", () => {
    expect(humanizeError(new Error("chain mismatch: wrong network"))).toContain("wrong network");
  });

  it("recognizes a nonce problem", () => {
    expect(humanizeError(new Error("nonce too low"))).toContain("nonce");
  });

  it("falls back to the first line, truncated to 200 chars", () => {
    const long = `${"x".repeat(300)}\nsecond line`;
    const out = humanizeError(new Error(long));
    expect(out.length).toBe(200);
    expect(out).not.toContain("second line");
  });

  it("handles non-Error/string inputs without throwing", () => {
    expect(typeof humanizeError("plain string error")).toBe("string");
    expect(typeof humanizeError(null)).toBe("string");
  });
});
