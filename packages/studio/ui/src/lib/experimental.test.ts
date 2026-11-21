import { describe, expect, it } from "vitest";
import readme from "../../../README.md?raw";
import { EXPERIMENTAL_NOTE, isExperimental } from "./experimental";

describe("experimental views", () => {
  it("are exactly the views that drive Avalanche CLI", () => {
    expect(isExperimental("devnet")).toBe(true);
    expect(isExperimental("fuji")).toBe(true);
    expect(isExperimental("interchain")).toBe(true);
    expect(isExperimental("overview")).toBe(false);
    expect(isExperimental("data")).toBe(false);
    expect(isExperimental("environment")).toBe(false);
  });

  it("say what the README says: maintenance mode since December 2025, last proven in July 2026", () => {
    expect(readme).toMatch(/maintenance mode in December 2025/);
    expect(readme).toMatch(/last proven end to end in July 2026/);
    expect(EXPERIMENTAL_NOTE).toMatch(/maintenance mode since December 2025/);
    expect(EXPERIMENTAL_NOTE).toMatch(/last proven end to end against a live network in July 2026/);
  });
});
