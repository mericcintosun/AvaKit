import type { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectPackageManager,
  isPackageManager,
  outputTail,
  type PackageManager,
  runPackageManager,
  runPackageManagerQuietly,
  spawnTarget,
} from "./pm.js";
import { canFakeBin, FAKE_BIN_TIMEOUT_MS, type FakeBin, fakeBin } from "./testing/fake-bin.js";

describe("detectPackageManager", () => {
  it("reads the manager from the user agent it sets", () => {
    const agents: [string, PackageManager][] = [
      ["npm/11.6.0 node/v24.11.0 darwin arm64 workspaces/false", "npm"],
      ["pnpm/10.20.0 npm/? node/v24.11.0 darwin arm64", "pnpm"],
      ["yarn/1.22.22 npm/? node/v24.11.0 linux x64", "yarn"],
      ["yarn/4.9.1 npm/? node/v24.11.0 win32 x64", "yarn"],
      ["bun/1.3.0 npm/? node/v24.3.0 linux x64", "bun"],
      ["  pnpm/10.20.0 npm/? node/v24.11.0 darwin arm64", "pnpm"],
    ];
    for (const [agent, expected] of agents) {
      expect(detectPackageManager(agent), agent).toBe(expected);
    }
  });

  it("returns null when the agent is missing, empty, or names another tool", () => {
    for (const agent of [undefined, "", "   ", "deno/2.5.0", "npminstall/7.12.0 npm/? node/v24"]) {
      expect(detectPackageManager(agent), String(agent)).toBeNull();
    }
  });
});

describe("isPackageManager", () => {
  it("accepts exactly the four supported managers", () => {
    for (const pm of ["pnpm", "npm", "yarn", "bun"]) expect(isPackageManager(pm)).toBe(true);
    for (const other of ["", "PNPM", "npx", "/usr/local/bin/pnpm", "pnpm install", undefined, 7]) {
      expect(isPackageManager(other), String(other)).toBe(false);
    }
  });
});

describe("spawnTarget", () => {
  it("starts the binary directly, with no shell, outside Windows", () => {
    for (const platform of ["darwin", "linux"] as const) {
      expect(spawnTarget("pnpm", ["install"], platform)).toEqual({
        command: "pnpm",
        args: ["install"],
        shell: false,
      });
    }
  });

  it("goes through a shell on Windows, as one command string", () => {
    // npm/pnpm/yarn are .cmd shims there, which Node cannot start without a shell.
    expect(spawnTarget("npm", ["run", "dev"], "win32")).toEqual({
      command: "npm run dev",
      args: [],
      shell: true,
    });
  });

  it("refuses anything but a known manager and plain arguments", () => {
    // These are what keeps user input away from the Windows shell.
    expect(() => spawnTarget("pnpm & calc" as PackageManager, ["install"], "win32")).toThrow(
      /Unknown package manager/,
    );
    expect(() => spawnTarget("C:\\tools\\pnpm" as PackageManager, ["install"], "win32")).toThrow(
      /Unknown package manager/,
    );
    for (const arg of ["install && calc", "--prefix=/tmp", "$(id)", "a b", ""]) {
      expect(() => spawnTarget("npm", [arg], "win32"), arg).toThrow(/Unsafe/);
    }
  });
});

describe("runPackageManager on Windows", () => {
  it("passes the shell flag and a single command string to spawn", () => {
    const spawned = vi.fn(() => ({ status: 0, signal: null }));
    const result = runPackageManager(
      "pnpm",
      ["install"],
      { cwd: "C:\\work\\my app", platform: "win32" },
      spawned as unknown as typeof spawnSync,
    );
    expect(result.ok).toBe(true);
    expect(spawned).toHaveBeenCalledWith("pnpm install", [], {
      cwd: "C:\\work\\my app",
      env: undefined,
      shell: true,
      stdio: "inherit",
    });
  });

  it("reports the shell's non-zero exit when the manager is missing", () => {
    // Through cmd.exe a missing command is an exit code, not an ENOENT.
    const spawned = vi.fn(() => ({ status: 1, signal: null }));
    const result = runPackageManager(
      "yarn",
      ["install"],
      { cwd: ".", platform: "win32" },
      spawned as unknown as typeof spawnSync,
    );
    expect(result).toMatchObject({ ok: false, failure: "exit-code", status: 1 });
  });
});

describe.skipIf(!canFakeBin)("running a package manager", { timeout: FAKE_BIN_TIMEOUT_MS }, () => {
  let bin: FakeBin;
  let cwd: string;

  beforeAll(() => {
    bin = fakeBin(["pnpm", "npm", "yarn", "bun"]);
  });
  afterAll(() => bin.cleanup());
  beforeEach(() => {
    bin.reset();
    cwd = mkdtempSync(path.join(tmpdir(), "caa-pm-"));
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("runs the command in the project directory and reports success", () => {
    const result = runPackageManager("pnpm", ["install"], { cwd, env: bin.env() });
    expect(result).toEqual({ ok: true, failure: null, status: 0, reason: "", output: "" });
    expect(bin.calls()).toEqual([`pnpm install @ ${realpathSync(cwd)}`]);
  });

  it("reports a non-zero exit as a failure", () => {
    const result = runPackageManager("npm", ["install"], { cwd, env: bin.env({ exit: 3 }) });
    expect(result).toMatchObject({
      ok: false,
      failure: "exit-code",
      status: 3,
      reason: '"npm install" exited with code 3',
    });
  });

  it("reports a manager that is not installed", () => {
    const result = runPackageManager("yarn", ["install"], { cwd, env: bin.emptyEnv() });
    expect(result).toMatchObject({
      ok: false,
      failure: "not-found",
      status: null,
      reason: '"yarn" was not found on your PATH',
    });
  });

  it("never throws, even for input that must not be run", () => {
    const result = runPackageManager("npm", ["install; id"], { cwd, env: bin.env() });
    expect(result).toMatchObject({ ok: false, failure: "not-started" });
    expect(bin.calls()).toEqual([]);
  });

  describe("quietly (the wizard's install)", () => {
    it("resolves ok without printing anything", async () => {
      const env = bin.env({ stdout: "installed 42 packages" });
      const result = await runPackageManagerQuietly("bun", ["install"], { cwd, env });
      expect(result).toMatchObject({ ok: true, failure: null, status: 0 });
      expect(bin.calls()).toEqual([`bun install @ ${realpathSync(cwd)}`]);
    });

    it("captures the tail of the output so a failure can say why", async () => {
      const env = bin.env({ exit: 1, stderr: "ERR_PNPM_FETCH_404 no such package" });
      const result = await runPackageManagerQuietly("pnpm", ["install"], { cwd, env });
      expect(result).toMatchObject({
        ok: false,
        failure: "exit-code",
        status: 1,
        reason: '"pnpm install" exited with code 1',
        output: "ERR_PNPM_FETCH_404 no such package",
      });
    });

    it("resolves (never rejects) when the manager is not installed", async () => {
      const env = bin.emptyEnv();
      const result = await runPackageManagerQuietly("yarn", ["install"], { cwd, env });
      expect(result).toMatchObject({
        ok: false,
        failure: "not-found",
        reason: '"yarn" was not found on your PATH',
      });
    });
  });

  describe("through a shell, as on Windows", () => {
    // `platform: "win32"` selects the shell path; on this machine the shell is
    // /bin/sh rather than cmd.exe, which is enough to run that path for real.
    const windows = { platform: "win32" } as const;

    it("launches the manager and reads its exit status", () => {
      const ok = runPackageManager("pnpm", ["install"], { cwd, env: bin.env(), ...windows });
      expect(ok).toMatchObject({ ok: true, status: 0 });
      expect(bin.calls()).toEqual([`pnpm install @ ${realpathSync(cwd)}`]);

      const env = bin.env({ exit: 2 });
      const failed = runPackageManager("npm", ["run", "dev"], { cwd, env, ...windows });
      expect(failed).toMatchObject({
        ok: false,
        failure: "exit-code",
        status: 2,
        reason: '"npm run dev" exited with code 2',
      });
    });

    it("reports a missing manager as a failed command, with what the shell said", async () => {
      // Behind a shell there is no ENOENT: the shell itself starts, then fails.
      const env = bin.emptyEnv();
      const result = await runPackageManagerQuietly("yarn", ["install"], { cwd, env, ...windows });
      expect(result).toMatchObject({ ok: false, failure: "exit-code", status: 127 });
      expect(result.output).toMatch(/yarn.*not found/);
    });
  });
});

describe("outputTail", () => {
  it("keeps the last few non-empty lines and drops colour codes", () => {
    const raw = [
      "line 1",
      "line 2",
      "",
      "\u001b[31mERR\u001b[39m something broke",
      "  at step",
      "line 5\r",
      "line 6",
      "",
    ].join("\n");
    expect(outputTail(raw)).toBe(
      ["ERR something broke", "  at step", "line 5", "line 6"].join("\n"),
    );
  });

  it("is empty for empty output", () => {
    expect(outputTail("")).toBe("");
    expect(outputTail("\n\n")).toBe("");
  });

  it("cuts an overlong line short", () => {
    const tail = outputTail(`short\n${"x".repeat(5000)}`);
    const [first, second] = tail.split("\n");
    expect(first).toBe("short");
    expect(second).toHaveLength(200);
    expect(second?.endsWith("…")).toBe(true);
  });
});
