import { describe, expect, it } from "vitest";
import { cb58ToHex } from "./cb58.js";
import { blockchainId } from "./testing/sandbox.js";

describe("cb58ToHex", () => {
  // Public, well-known Avalanche blockchain IDs and their bytes32 form.
  it("decodes known blockchain IDs", () => {
    expect(cb58ToHex("yH8D7ThNJkxmtkuv2jgBa4P1Rn3Qpr4pPr7QYNfcdoS6k6HWp")).toBe(
      "0x7fc93d85c6d62c5b2ac0b519c87010ea5294012d1e407030d6acd0021cac10d5",
    );
    expect(cb58ToHex("2q9e4r6Mu3U68nU1fYjgbR6JvwrRx36CohpAX5UQxse55x1Q5")).toBe(
      "0x0427d4b22a2a78bcddd456742caf91b56badbff985ee19aef14573e7343fd652",
    );
  });

  it("keeps leading zero bytes (the P-Chain ID is all zeros)", () => {
    expect(cb58ToHex("11111111111111111111111111111111LpoYY")).toBe(`0x${"00".repeat(32)}`);
  });

  it("round-trips IDs produced by an independent encoder", () => {
    for (let seed = 0; seed < 50; seed++) {
      const id = blockchainId(seed);
      expect(cb58ToHex(id.cb58)).toBe(id.hex);
    }
  });

  it("rejects an ID whose checksum does not match", () => {
    // The Fuji C-Chain ID with one payload bit flipped and the old checksum kept.
    expect(() => cb58ToHex("yH8D7ThPC46pKhVQgxgZoRLdWdryPkThj43zmwspVAcnv4Qik")).toThrow(
      /checksum mismatch/,
    );
  });

  it("rejects a payload that is not 32 bytes, even with a valid checksum", () => {
    // 20 bytes plus their correct checksum.
    expect(() => cb58ToHex("12D2adLM3UKy4Z4giRbReR6gjWsUiMiw")).toThrow(/expected 32 bytes/);
    expect(() => cb58ToHex("")).toThrow(/expected 32 bytes/);
    expect(() => cb58ToHex("1")).toThrow(/expected 32 bytes/);
  });

  it("rejects characters outside the base58 alphabet", () => {
    expect(() => cb58ToHex("0OIl")).toThrow(/invalid CB58 character/);
  });
});
