import { describe, expect, it, vi } from "vitest";
import { fakeTerminal, KEY } from "../testing/fake-terminal.js";
import { type InstallOutcome, runWizard, type StartCommand, type WizardProps } from "./wizard.js";

const TEMPLATES = [
  { id: "minimal", title: "Minimal", description: "" },
  { id: "nft-mint", title: "NFT mint", description: "" },
];

const DEV: StartCommand = {
  pm: "pnpm",
  args: ["run", "dev"],
  cwd: "/work/app",
  label: "Start the dev server now? (pnpm run dev)",
};

const OK: InstallOutcome = { ok: true, reason: "", output: "" };

/** Props with every answer preset, so the wizard goes straight to scaffolding. */
function props(overrides: Partial<WizardProps> = {}): WizardProps {
  return {
    version: "0.0.0-test",
    templates: TEMPLATES,
    packageManagers: ["pnpm", "npm", "yarn", "bun"],
    detectedPackageManager: null,
    presets: { projectName: "app", template: "minimal", chain: "fuji", pm: "pnpm" },
    scaffold: async () => ({ created: 12 }),
    install: async () => OK,
    nextSteps: (a, installed) => [
      `cd ${a.projectName}`,
      ...(installed ? [] : [`${a.pm} install`]),
      `${a.pm} run dev`,
    ],
    startCommand: (_a, installed) => (installed ? DEV : null),
    ...overrides,
  };
}

describe("wizard install step", () => {
  it("offers the dev server once the install has succeeded", async () => {
    const term = fakeTerminal();
    const done = runWizard(props(), term.renderOptions);

    await term.waitFor("Start the dev server now?");
    expect(term.frame()).toContain("✓ Created 12 files");
    expect(term.frame()).toContain("✓ Dependencies installed");
    expect(term.frame()).toContain("Your Avalanche dapp is ready.");
    // Installed, so the install is not listed as something left to do.
    expect(term.frame()).not.toContain("pnpm install");

    term.press("y");
    await expect(done).resolves.toEqual({ outcome: "created", start: DEV });
  });

  it("reports a failed install, lists it as a next step, and does not offer the dev server", async () => {
    const startCommand = vi.fn(props().startCommand);
    const term = fakeTerminal();
    const result = await runWizard(
      props({
        presets: { projectName: "app", template: "minimal", chain: "fuji", pm: "yarn" },
        install: async () => ({
          ok: false,
          reason: '"yarn" was not found on your PATH',
          output: "",
        }),
        startCommand,
      }),
      term.renderOptions,
    );

    expect(result).toEqual({ outcome: "created", start: null });
    const screen = term.frame();
    expect(screen).toContain(
      '! Dependencies were not installed: "yarn" was not found on your PATH',
    );
    expect(screen).toContain("was created, but its dependencies are not installed.");
    expect(screen).not.toContain("Your Avalanche dapp is ready.");
    expect(screen).toContain("yarn install");
    expect(screen).not.toContain("Start the dev server now?");
    // The offer is decided on the install's result, not on whether one was requested.
    expect(startCommand).toHaveBeenLastCalledWith(expect.anything(), false);
  });

  it("shows what the package manager printed when it fails", async () => {
    const term = fakeTerminal();
    await runWizard(
      props({
        install: async () => ({
          ok: false,
          reason: '"pnpm install" exited with code 1',
          output: "ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/nope: Not Found",
        }),
      }),
      term.renderOptions,
    );
    expect(term.frame()).toContain('"pnpm install" exited with code 1');
    expect(term.frame()).toContain("ERR_PNPM_FETCH_404");
  });

  it("keeps rendering while the install runs", async () => {
    let finish: (outcome: InstallOutcome) => void = () => {};
    const term = fakeTerminal();
    const done = runWizard(
      props({ install: () => new Promise<InstallOutcome>((resolve) => (finish = resolve)) }),
      term.renderOptions,
    );

    // The old synchronous install blocked the event loop, so this frame never appeared.
    await term.waitFor("Installing dependencies with pnpm");
    expect(term.frame()).toContain("✓ Created 12 files");
    expect(term.frame()).not.toContain("Next steps");

    finish(OK);
    await term.waitFor("Start the dev server now?");
    term.press("n");
    await expect(done).resolves.toEqual({ outcome: "created", start: null });
  });

  it("lists the install as a next step when it was skipped (--no-install)", async () => {
    const term = fakeTerminal();
    const result = await runWizard(props({ install: null }), term.renderOptions);
    expect(result).toEqual({ outcome: "created", start: null });
    expect(term.frame()).toContain("pnpm install");
    expect(term.frame()).not.toContain("Dependencies");
    expect(term.frame()).not.toContain("Start the dev server now?");
  });

  it("reports a scaffold failure as failed and never installs", async () => {
    const install = vi.fn(async () => OK);
    const term = fakeTerminal();
    const result = await runWizard(
      props({
        scaffold: async () => {
          throw new Error('Directory "app" already exists and is not empty.');
        },
        install,
      }),
      term.renderOptions,
    );
    expect(result).toEqual({ outcome: "failed", start: null });
    expect(term.frame()).toContain('✗ Directory "app" already exists and is not empty.');
    expect(install).not.toHaveBeenCalled();
  });
});

describe("wizard package manager step", () => {
  it("lists the managers in the order given and labels the detected one", async () => {
    const term = fakeTerminal();
    const done = runWizard(
      props({
        packageManagers: ["yarn", "pnpm", "npm", "bun"],
        detectedPackageManager: "yarn",
        presets: { projectName: "app", template: "minimal", chain: "fuji" },
        install: null,
      }),
      term.renderOptions,
    );

    await term.waitFor("Package manager");
    const frame = term.frame();
    expect(frame).toContain("yarn  ·  detected");
    expect(frame.indexOf("yarn")).toBeLessThan(frame.indexOf("pnpm"));

    // Enter takes the first entry — the detected manager.
    term.press(KEY.enter);
    await term.waitFor("Create the app now?");
    expect(term.frame()).toMatch(/Package manager\s+yarn/);
    term.press("n");
    await expect(done).resolves.toEqual({ outcome: "cancelled", start: null });
  });
});
