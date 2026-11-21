import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { experimentalWarning, listTemplates, templatesDir } from "./api.js";
import { run } from "./cli.js";
import type { WizardProps, WizardResult } from "./ui/wizard.js";

/**
 * What the CLI says about an experimental template: the help names them, a
 * non-interactive run prints the warning before it scaffolds, and the wizard is
 * handed the same line to show. The wizard's own rendering is tested in
 * ui/wizard-experimental.test.ts; here it is a stand-in that records its props.
 */

const runWizard = vi.fn<(props: WizardProps) => Promise<WizardResult>>();
vi.mock("./ui/wizard.js", () => ({ runWizard }));

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI colour codes.
const ANSI = /\u001b\[[0-9;]*m/g;

const EXPERIMENTAL = ["icm-messenger", "l1-launch", "token-bridge"];

let cwd: string;
let configDir: string;
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "caa-experimental-"));
  configDir = mkdtempSync(path.join(tmpdir(), "caa-experimental-config-"));
  runWizard.mockReset();
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

/** Run the CLI in-process with telemetry off; non-interactive unless `tty`. */
async function invoke(argv: string[], tty = false) {
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
    stdinIsTTY: tty,
    platform: process.platform,
  });
  return { code, stdout: stdout.replace(ANSI, ""), stderr: stderr.replace(ANSI, "") };
}

/** The warning line the manifest of `id` produces. */
function warningFor(id: string): string {
  const template = listTemplates().find((t) => t.id === id);
  const warning = template ? experimentalWarning(template) : null;
  if (!warning) throw new Error(`${id} is not an experimental template`);
  return warning;
}

describe("an experimental template, non-interactive", () => {
  it("prints the warning on stderr, then scaffolds as usual", async () => {
    for (const id of EXPERIMENTAL) {
      const result = await invoke([id, "--template", id, "--yes", "--no-install"]);
      expect(result.code, id).toBe(0);
      expect(result.stderr, id).toBe(`\nWarning: ${warningFor(id)}\n`);
      expect(result.stderr, id).toContain("Avalanche CLI");
      expect(result.stdout, id).toContain("Done. Next steps:");
      expect(existsSync(path.join(cwd, id, "package.json")), id).toBe(true);
    }
  });

  it("prints it before a refused directory is reported, so a failed run still shows it", async () => {
    await invoke(["app", "--yes", "--no-install"]);
    const again = await invoke(["app", "--template", "l1-launch", "--yes", "--no-install"]);
    expect(again.code).toBe(1);
    expect(again.stderr).toBe(
      `\nWarning: ${warningFor("l1-launch")}\n` +
        '\nDirectory "app" already exists and is not empty.\n',
    );
  });

  it("prints nothing extra for a stable template", async () => {
    for (const template of listTemplates().filter((t) => t.status === "stable")) {
      const result = await invoke([template.id, "-t", template.id, "-y", "--no-install"]);
      expect(result.code, template.id).toBe(0);
      expect(result.stderr, template.id).toBe("");
    }
  });
});

describe("an experimental template's own docs", () => {
  it("say so in its README, CLAUDE.md and llms.txt, with the reason and the last full run", () => {
    // What a developer and their coding agent read in the generated app: the
    // label in the CLI is not the only place it may say so.
    const experimental = listTemplates().filter((t) => t.status === "experimental");
    expect(experimental.map((t) => t.id).sort()).toEqual(EXPERIMENTAL);
    for (const template of experimental) {
      for (const file of ["README.md", "CLAUDE.md", "llms.txt"]) {
        const text = readFileSync(path.join(templatesDir, template.id, file), "utf8")
          // Prose wraps; compare it as one line.
          .replace(/\s*\n>?\s*/g, " ");
        const where = `${template.id}/${file}`;
        expect(text, where).toMatch(/experimental/i);
        expect(text, where).toContain("Avalanche CLI");
        expect(text, where).toContain("maintenance mode since December 2025");
        expect(text, where).toContain("last proven end to end in July 2026");
      }
    }
  });
});

describe("--help", () => {
  it("names the experimental templates, from their manifests", async () => {
    const help = await invoke(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("experimental: icm-messenger, token-bridge, l1-launch");
  });
});

describe("an experimental template, interactive", () => {
  it("hands the wizard each template's warning, and only the experimental ones have one", async () => {
    runWizard.mockResolvedValue({ outcome: "declined", start: null });
    const result = await invoke([], true);
    expect(result.code).toBe(0);

    const [props] = runWizard.mock.calls[0] ?? [];
    const warnings = Object.fromEntries((props?.templates ?? []).map((t) => [t.id, t.warning]));
    expect(warnings).toEqual({
      minimal: null,
      "nft-mint": null,
      "token-gated-app": null,
      "erc20-token": null,
      "icm-messenger": warningFor("icm-messenger"),
      "token-bridge": warningFor("token-bridge"),
      "eerc-token": null,
      "l1-launch": warningFor("l1-launch"),
    });
  });

  it("leaves the warning to the wizard instead of printing it as well", async () => {
    runWizard.mockResolvedValue({ outcome: "declined", start: null });
    const result = await invoke(["--template", "l1-launch"], true);
    expect(result.code).toBe(0);
    expect(runWizard.mock.calls[0]?.[0].presets).toMatchObject({ template: "l1-launch" });
    expect(result.stderr).toBe("");
  });
});
