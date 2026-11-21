import { describe, expect, it, vi } from "vitest";
import { fakeTerminal, KEY } from "../testing/fake-terminal.js";
import { runWizard, type WizardProps } from "./wizard.js";

/**
 * An experimental template in the wizard: labelled in the list, and warned
 * about from the moment it is chosen until the wizard ends. The warnings here
 * are short so that a line never wraps on the fake terminal's 100 columns.
 */

const WARNING = 'Template "l1-launch" is experimental. It needs Avalanche CLI.';

const TEMPLATES = [
  { id: "minimal", title: "Minimal", description: "", chains: ["fuji", "c-chain"], warning: null },
  { id: "nft-mint", title: "NFT mint", description: "", chains: ["fuji"], warning: null },
  {
    id: "l1-launch",
    title: "Launch your own L1",
    description: "",
    chains: ["fuji"],
    warning: WARNING,
  },
];

function props(overrides: Partial<WizardProps> = {}): WizardProps {
  return {
    version: "0.0.0-test",
    templates: TEMPLATES,
    packageManagers: ["pnpm", "npm", "yarn", "bun"],
    detectedPackageManager: null,
    presets: { projectName: "app", pm: "pnpm" },
    validateName: () => null,
    scaffold: async () => ({ created: 12 }),
    // Skipped, so there is no install to wait for and no dev-server offer.
    install: null,
    nextSteps: (a) => [`cd ${a.projectName}`, `${a.pm} install`, `${a.pm} run dev`],
    startCommand: () => null,
    ...overrides,
  };
}

describe("wizard experimental template", () => {
  it("labels it in the list, then warns from the moment it is chosen to the end", async () => {
    const scaffold = vi.fn(async () => ({ created: 12 }));
    const term = fakeTerminal();
    const done = runWizard(props({ scaffold }), term.renderOptions);

    await term.waitFor("Launch your own L1  ·  experimental");
    // Labelled, but not warned about before anyone picked it.
    expect(term.frame()).not.toContain(WARNING);
    expect(term.frame()).not.toContain("Minimal  ·  experimental");

    term.press(KEY.down);
    await term.waitFor("❯ NFT mint");
    term.press(KEY.down);
    await term.waitFor("❯ Launch your own L1");
    term.press(KEY.enter);
    await term.waitFor("Network");
    expect(term.frame()).toContain(`! ${WARNING}`);

    term.press(KEY.enter);
    await term.waitFor("Create the app now?");
    expect(term.frame()).toContain(`! ${WARNING}`);

    term.press("y");
    await expect(done).resolves.toEqual({ outcome: "created", start: null });
    expect(term.frame()).toContain("Your Avalanche dapp is ready.");
    expect(term.frame()).toContain(`! ${WARNING}`);
    expect(scaffold).toHaveBeenCalledWith({
      projectName: "app",
      template: "l1-launch",
      chain: "fuji",
      pm: "pnpm",
    });
  });

  it("warns from the first question when the template came from the command line", async () => {
    const term = fakeTerminal();
    const done = runWizard(
      props({ presets: { template: "l1-launch", chain: "fuji", pm: "pnpm" } }),
      term.renderOptions,
    );

    await term.waitFor("Project name");
    expect(term.frame()).toContain(`! ${WARNING}`);
    term.press(KEY.enter);
    await term.waitFor("Create the app now?");
    expect(term.frame()).toContain(`! ${WARNING}`);
    term.press("n");
    await expect(done).resolves.toEqual({ outcome: "declined", start: null });
  });

  it("does not warn about a stable template", async () => {
    const term = fakeTerminal();
    const done = runWizard(props(), term.renderOptions);

    await term.waitFor("Template");
    term.press(KEY.enter);
    await term.waitFor("Network");
    term.press(KEY.enter);
    await term.waitFor("Create the app now?");
    expect(term.frame()).toMatch(/Template\s+Minimal/);
    expect(term.frame()).not.toContain("experimental");
    term.press("n");
    await expect(done).resolves.toEqual({ outcome: "declined", start: null });
  });
});
