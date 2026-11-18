import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scaffoldApp } from "./api.js";

// A disk that fills up after a set number of files. Everything else about the
// filesystem is real.
const disk = vi.hoisted(() => ({ room: Number.POSITIVE_INFINITY }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    writeFile: async (...args: Parameters<typeof real.writeFile>) => {
      if (disk.room <= 0) {
        throw Object.assign(new Error("ENOSPC: no space left on device, write"), {
          code: "ENOSPC",
        });
      }
      disk.room--;
      return real.writeFile(...args);
    },
  };
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "caa-failure-"));
  disk.room = Number.POSITIVE_INFINITY;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("scaffoldApp when writing fails part-way", () => {
  it("removes the project directory it created, so a retry is not refused", async () => {
    const target = path.join(dir, "app");
    disk.room = 3;
    await expect(
      scaffoldApp({ projectName: "app", targetDir: target, template: "minimal" }),
    ).rejects.toThrow(/ENOSPC/);
    // The three files that made it used to stay behind, and the next attempt
    // then failed with "already exists and is not empty".
    expect(existsSync(target)).toBe(false);

    disk.room = Number.POSITIVE_INFINITY;
    const retry = await scaffoldApp({ projectName: "app", targetDir: target, template: "minimal" });
    expect(retry.files.length).toBeGreaterThan(3);
    expect(existsSync(path.join(target, "package.json"))).toBe(true);
  });

  it("never removes a directory that was there before it started", async () => {
    const target = path.join(dir, "existing");
    mkdirSync(target);
    disk.room = 3;
    await expect(
      scaffoldApp({ projectName: "app", targetDir: target, template: "minimal" }),
    ).rejects.toThrow(/ENOSPC/);
    expect(existsSync(target)).toBe(true);
    expect(readdirSync(target).length).toBeGreaterThan(0);
  });
});
