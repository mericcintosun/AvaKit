import { describe, expect, it } from "vitest";
import { assertSafeProjectName, scaffoldApp } from "./api.js";

describe("assertSafeProjectName", () => {
  it("accepts ordinary project names", () => {
    for (const name of ["my-avax-app", "app.v2", "App123", "a", "my_app"]) {
      expect(() => assertSafeProjectName(name)).not.toThrow();
    }
  });

  it("rejects traversal, absolute paths, separators, and dotfiles", () => {
    for (const name of [
      "",
      "..",
      "../evil",
      "foo/../bar",
      "/etc/passwd",
      "a/b",
      "a\\b",
      "C:\\Windows",
      ".env",
      ".ssh",
      "bad name",
      "trailing.",
      "a".repeat(65),
    ]) {
      expect(() => assertSafeProjectName(name), name).toThrow();
    }
  });
});

describe("scaffoldApp", () => {
  it("refuses an unsafe projectName before touching the filesystem", async () => {
    await expect(
      scaffoldApp({ projectName: "../evil", targetDir: "/tmp/whatever", template: "minimal" }),
    ).rejects.toThrow(/Invalid project name/);
  });
});
