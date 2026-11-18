import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERRUPTED_EXIT_CODE, run, type WizardProgress, wizardExit } from "./cli.js";
import type { WizardProps, WizardResult } from "./ui/wizard.js";

/**
 * How the interactive run ends: the exit code and the last line for each way
 * out of the wizard. The wizard itself is replaced by a stand-in that drives
 * the CLI's real callbacks (so a scaffold really happens when one is asked for)
 * and then ends the way a test says.
 */

const runWizard = vi.fn<(props: WizardProps) => Promise<WizardResult>>();
vi.mock("./ui/wizard.js", () => ({ runWizard }));

const NOTHING: WizardProgress = { projectName: null, scaffolded: false, installed: null };

describe("wizardExit", () => {
  it("gives the shell's Ctrl+C status, 130, to an interrupted wizard however far it got", () => {
    expect(INTERRUPTED_EXIT_CODE).toBe(130);
    for (const progress of [
      NOTHING,
      { projectName: "app", scaffolded: false, installed: null },
      { projectName: "app", scaffolded: true, installed: null },
      { projectName: "app", scaffolded: true, installed: false },
      { projectName: "app", scaffolded: true, installed: true },
    ]) {
      const ending = wizardExit("interrupted", progress);
      expect(ending.code, JSON.stringify(progress)).toBe(130);
      expect(ending.toStderr).toBe(true);
    }
  });

  it("says in one line what an interrupted wizard left on disk", () => {
    expect(wizardExit("interrupted", NOTHING).line).toBe("Cancelled. Nothing was created.");
    expect(
      wizardExit("interrupted", { projectName: "app", scaffolded: false, installed: null }).line,
    ).toBe("Cancelled while ./app was being created: its files may be incomplete.");
    expect(
      wizardExit("interrupted", { projectName: "app", scaffolded: true, installed: null }).line,
    ).toBe("Cancelled. The project was created in ./app, but its dependencies are not installed.");
    expect(
      wizardExit("interrupted", { projectName: "app", scaffolded: true, installed: false }).line,
    ).toBe("Cancelled. The project was created in ./app, but its dependencies are not installed.");
    expect(
      wizardExit("interrupted", { projectName: "app", scaffolded: true, installed: true }).line,
    ).toBe("Cancelled. The project was created in ./app and its dependencies are installed.");
  });

  it("keeps a deliberate No at the review at 0, and says nothing was created", () => {
    expect(wizardExit("declined", NOTHING)).toEqual({
      code: 0,
      line: "Nothing was created.",
      toStderr: false,
    });
  });

  it("fails a failed scaffold, and a created app whose install failed, with 1", () => {
    expect(wizardExit("failed", NOTHING)).toEqual({ code: 1, line: null, toStderr: true });
    const created = { projectName: "app", scaffolded: true };
    expect(wizardExit("created", { ...created, installed: false }).code).toBe(1);
    expect(wizardExit("created", { ...created, installed: true }).code).toBe(0);
    // --no-install: nothing ran, nothing failed.
    expect(wizardExit("created", { ...created, installed: null }).code).toBe(0);
  });
});

describe("the interactive run's exit code", () => {
  let cwd: string;
  let configDir: string;
  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "caa-wizard-exit-"));
    configDir = mkdtempSync(path.join(tmpdir(), "caa-wizard-exit-config-"));
    runWizard.mockReset();
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
  });

  async function invoke(argv: string[] = []) {
    let stdout = "";
    let stderr = "";
    const code = await run({
      argv,
      cwd,
      env: {
        AVAKIT_TELEMETRY_DISABLED: "1",
        AVAKIT_TELEMETRY_URL: "http://127.0.0.1:9/e",
        AVAKIT_CONFIG_DIR: configDir,
      },
      stdout: { write: (text) => (stdout += text) },
      stderr: { write: (text) => (stderr += text) },
      stdinIsTTY: true,
      platform: process.platform,
    });
    return { code, stdout, stderr };
  }

  const ANSWERS = { projectName: "app", template: "minimal", chain: "fuji", pm: "npm" };

  it("exits 130 when Ctrl+C ends the wizard at a prompt, with nothing created", async () => {
    runWizard.mockResolvedValue({ outcome: "interrupted", start: null });

    const result = await invoke();
    expect(result.code).toBe(130);
    expect(result.stderr).toBe("\nCancelled. Nothing was created.\n");
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("exits 130 when Ctrl+C ends the wizard after the scaffold, and names the directory", async () => {
    runWizard.mockImplementation(async (props) => {
      await props.scaffold(ANSWERS);
      return { outcome: "interrupted", start: null };
    });

    // --no-install: the scaffold is real, and nothing is installed.
    const result = await invoke(["--no-install"]);
    expect(result.code).toBe(130);
    expect(result.stderr).toBe(
      "\nCancelled. The project was created in ./app, but its dependencies are not installed.\n",
    );
    expect(existsSync(path.join(cwd, "app", "package.json"))).toBe(true);
  });

  it("exits 0 when the user answers No at the review", async () => {
    runWizard.mockResolvedValue({ outcome: "declined", start: null });

    const result = await invoke();
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("\nNothing was created.\n");
    expect(result.stderr).toBe("");
  });

  it("exits 0 for a finished scaffold whose dev-server offer was turned down", async () => {
    runWizard.mockImplementation(async (props) => {
      await props.scaffold(ANSWERS);
      return { outcome: "created", start: null };
    });

    const result = await invoke(["--no-install"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("Nothing was created.");
  });
});
