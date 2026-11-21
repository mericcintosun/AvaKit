import { describe, expect, it } from "vitest";
import readme from "../../../README.md?raw";
import { EXPERIMENTAL_NOTE, isExperimental } from "./experimental";

describe("experimental views", () => {
  it("are exactly the views that depend on Avalanche CLI", () => {
    expect(isExperimental("devnet")).toBe(true);
    expect(isExperimental("fuji")).toBe(true);
    expect(isExperimental("interchain")).toBe(true);
    expect(isExperimental("overview")).toBe(false);
    expect(isExperimental("data")).toBe(false);
    expect(isExperimental("environment")).toBe(false);
  });

  it("say what the README says: maintenance mode since December 2025, last proven in July 2026, changed since", () => {
    expect(readme).toMatch(/maintenance mode in December 2025/);
    expect(readme).toMatch(/last proven end to end in July 2026\. Studio has changed since then/);
    expect(EXPERIMENTAL_NOTE).toMatch(/maintenance mode since December 2025/);
    expect(EXPERIMENTAL_NOTE).toMatch(
      /last proven end to end against a live network in July 2026, and Studio has changed since/,
    );
  });

  it("does not say that every view runs the CLI: Interchain only works on what it set up", () => {
    expect(EXPERIMENTAL_NOTE).toMatch(/it runs the CLI, or works on what the CLI set up/);
    expect(EXPERIMENTAL_NOTE).not.toMatch(/drives Avalanche CLI/);
  });
});
