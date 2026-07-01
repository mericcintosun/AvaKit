import { describe, expect, it } from "vitest";
import { getBytecode } from "./deploy.js";
import { DeployFailedError } from "./errors.js";

describe("getBytecode", () => {
  it("reads the Foundry object shape", () => {
    expect(getBytecode({ abi: [], bytecode: { object: "0x6080" } })).toBe("0x6080");
  });

  it("reads the flat hex shape", () => {
    expect(getBytecode({ abi: [], bytecode: "0xdead" })).toBe("0xdead");
  });

  it("throws when bytecode is missing or unprefixed", () => {
    expect(() => getBytecode({ abi: [], bytecode: "6080" as `0x${string}` })).toThrow(
      DeployFailedError,
    );
  });
});
