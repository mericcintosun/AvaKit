import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectNameProblem } from "../cli.js";
import { fakeTerminal, KEY } from "../testing/fake-terminal.js";
import { type InstallOutcome, runWizard, type StartCommand, type WizardProps } from "./wizard.js";

const TEMPLATES = [
  { id: "minimal", title: "Minimal", description: "", chains: ["fuji", "c-chain"] },
  { id: "nft-mint", title: "NFT mint", description: "", chains: ["fuji"] },
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
    validateName: () => null,
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
    await expect(done).resolves.toEqual({ outcome: "declined", start: null });
  });
});

describe("wizard network step", () => {
  /** Run the wizard up to the review screen and return the scaffold's answers. */
  async function chooseTemplate(keys: string[]) {
    const scaffold = vi.fn(async () => ({ created: 12 }));
    const term = fakeTerminal();
    const done = runWizard(
      props({ presets: { projectName: "app", pm: "pnpm" }, scaffold, install: null }),
      term.renderOptions,
    );
    await term.waitFor("Template");
    for (const key of keys) term.press(key);
    await term.waitFor("Network");
    return { term, done, scaffold };
  }

  it("offers only Fuji for a Fuji-only template, and says why", async () => {
    const { term, done, scaffold } = await chooseTemplate([KEY.down, KEY.enter]);
    await term.waitFor("NFT mint runs on Fuji testnet only.");
    // Mainnet used to be listed here for every template.
    expect(term.frame()).not.toContain("C-Chain (mainnet)");

    term.press(KEY.enter);
    await term.waitFor("Create the app now?");
    expect(term.frame()).toMatch(/Network\s+Fuji testnet/);
    term.press("y");
    await done;
    expect(scaffold).toHaveBeenCalledWith({
      projectName: "app",
      template: "nft-mint",
      chain: "fuji",
      pm: "pnpm",
    });
  });

  it("offers both networks for a template that supports mainnet", async () => {
    const { term, done, scaffold } = await chooseTemplate([KEY.enter]);
    await term.waitFor("C-Chain (mainnet)");
    expect(term.frame()).toContain("Fuji testnet  ·  recommended");
    expect(term.frame()).not.toContain("only.");

    term.press(KEY.down);
    await term.waitFor("❯ C-Chain (mainnet)");
    term.press(KEY.enter);
    await term.waitFor("Create the app now?");
    expect(term.frame()).toMatch(/Network\s+C-Chain \(mainnet\)/);
    term.press("y");
    await done;
    expect(scaffold).toHaveBeenCalledWith({
      projectName: "app",
      template: "minimal",
      chain: "c-chain",
      pm: "pnpm",
    });
  });

  it("lists only the templates that run on a network given up front", async () => {
    const scaffold = vi.fn(async () => ({ created: 12 }));
    const term = fakeTerminal();
    const done = runWizard(
      props({
        presets: { projectName: "app", chain: "c-chain", pm: "pnpm" },
        scaffold,
        install: null,
      }),
      term.renderOptions,
    );
    await term.waitFor("Only the templates that run on C-Chain (mainnet) are listed.");
    expect(term.frame()).toContain("Minimal");
    expect(term.frame()).not.toContain("NFT mint");

    term.press(KEY.enter);
    await term.waitFor("Create the app now?");
    term.press("y");
    await done;
    expect(scaffold).toHaveBeenCalledWith({
      projectName: "app",
      template: "minimal",
      chain: "c-chain",
      pm: "pnpm",
    });
  });
});

describe("wizard project name step", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "caa-wizard-"));
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  /** A wizard that only asks for the name, validated by the CLI's real rule. */
  function askName() {
    const term = fakeTerminal();
    const done = runWizard(
      props({
        presets: { template: "minimal", chain: "fuji", pm: "pnpm" },
        validateName: (name) => projectNameProblem(name, cwd),
        install: null,
      }),
      term.renderOptions,
    );
    return { term, done };
  }

  it("rejects a name the scaffolder would reject, and lets the user fix it", async () => {
    const { term, done } = askName();
    await term.waitFor("Project name");

    // The wizard's old pattern accepted a trailing dash; the scaffolder never
    // did, so the run failed only after every other question had been answered.
    term.press("my-app-");
    await term.waitFor("my-app-");
    term.press(KEY.enter);
    await term.waitFor('Invalid project name "my-app-"');
    expect(term.frame()).not.toContain("Create the app now?");

    term.press("x");
    await term.waitFor("my-app-x");
    term.press(KEY.enter);
    await term.waitFor("Create the app now?");
    expect(term.frame()).toMatch(/Project name\s+my-app-x/);
    term.press("n");
    await expect(done).resolves.toEqual({ outcome: "declined", start: null });
  });

  it("accepts a name the scaffolder accepts, capitals included", async () => {
    const { term, done } = askName();
    await term.waitFor("Project name");
    term.press("App123");
    await term.waitFor("App123");
    term.press(KEY.enter);
    await term.waitFor("Create the app now?");
    expect(term.frame()).toMatch(/Project name\s+App123/);
    term.press("n");
    await done;
  });

  it("says straight away when the directory is already taken", async () => {
    mkdirSync(path.join(cwd, "taken"));
    writeFileSync(path.join(cwd, "taken", "notes.txt"), "keep me");

    const { term, done } = askName();
    await term.waitFor("Project name");
    term.press("taken");
    await term.waitFor("taken");
    term.press(KEY.enter);
    await term.waitFor('Directory "taken" already exists and is not empty.');
    expect(term.frame()).not.toContain("Create the app now?");

    term.press("2");
    await term.waitFor("taken2");
    term.press(KEY.enter);
    await term.waitFor("Create the app now?");
    term.press("n");
    await done;
  });
});

describe("leaving the wizard", () => {
  /** Ctrl+C as a terminal in raw mode delivers it: one byte of input, not a signal. */
  const CTRL_C = "\u0003";

  it("reports Ctrl+C at the first prompt as interrupted, before anything is scaffolded", async () => {
    const scaffold = vi.fn(props().scaffold);
    const term = fakeTerminal();
    const done = runWizard(
      props({ presets: { template: "minimal", chain: "fuji", pm: "pnpm" }, scaffold }),
      // Ink's own Ctrl+C handling, which the real CLI keeps on.
      { ...term.renderOptions, exitOnCtrlC: true },
    );

    await term.waitFor("Project name");
    term.press(CTRL_C);
    await expect(done).resolves.toEqual({ outcome: "interrupted", start: null });
    expect(scaffold).not.toHaveBeenCalled();
  });

  it("reports Ctrl+C at the review as interrupted, not as a No", async () => {
    const scaffold = vi.fn(props().scaffold);
    const term = fakeTerminal();
    const done = runWizard(
      props({ presets: { projectName: "app", template: "minimal", chain: "fuji" }, scaffold }),
      { ...term.renderOptions, exitOnCtrlC: true },
    );

    await term.waitFor("Package manager");
    term.press(KEY.enter);
    await term.waitFor("Create the app now?");
    term.press(CTRL_C);
    await expect(done).resolves.toEqual({ outcome: "interrupted", start: null });
    expect(scaffold).not.toHaveBeenCalled();
  });

  it("reports Ctrl+C at the dev-server offer as interrupted, after the app was made", async () => {
    const scaffold = vi.fn(props().scaffold);
    const term = fakeTerminal();
    const done = runWizard(props({ scaffold }), { ...term.renderOptions, exitOnCtrlC: true });

    await term.waitFor("Start the dev server now?");
    term.press(CTRL_C);
    await expect(done).resolves.toEqual({ outcome: "interrupted", start: null });
    expect(scaffold).toHaveBeenCalledTimes(1);
  });

  it("reports No to the dev-server offer as created: a finished app, not a cancellation", async () => {
    const term = fakeTerminal();
    const done = runWizard(props(), term.renderOptions);

    await term.waitFor("Start the dev server now?");
    term.press("n");
    await expect(done).resolves.toEqual({ outcome: "created", start: null });
  });

  it("reports No to the review as declined", async () => {
    const scaffold = vi.fn(props().scaffold);
    const term = fakeTerminal();
    const done = runWizard(
      props({ presets: { projectName: "app", template: "minimal", chain: "fuji" }, scaffold }),
      term.renderOptions,
    );

    await term.waitFor("Package manager");
    term.press(KEY.enter);
    await term.waitFor("Create the app now?");
    term.press("n");
    await expect(done).resolves.toEqual({ outcome: "declined", start: null });
    expect(scaffold).not.toHaveBeenCalled();
  });
});
