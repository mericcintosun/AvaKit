import { describe, expect, it } from "vitest";
import {
  chainLabel,
  optionsFor,
  restrictionNote,
  type StepContext,
  templateWarning,
} from "./steps.js";

const ctx: StepContext = {
  templates: [
    { id: "minimal", title: "Minimal", description: "", chains: ["fuji", "c-chain"] },
    { id: "nft-mint", title: "NFT mint", description: "", chains: ["fuji"] },
    { id: "eerc-token", title: "Confidential token (eERC)", description: "", chains: ["fuji"] },
  ],
  packageManagers: ["npm", "pnpm", "yarn", "bun"],
  detectedPackageManager: "npm",
};

/** The same templates plus an experimental one, as the CLI hands them over. */
const withExperimental: StepContext = {
  ...ctx,
  templates: [
    ...ctx.templates.map((t) => ({ ...t, warning: null })),
    {
      id: "l1-launch",
      title: "Launch your own L1",
      description: "",
      chains: ["fuji"],
      warning: 'Template "l1-launch" is experimental. It needs Avalanche CLI.',
    },
  ],
};

const values = (options: { value: string }[]) => options.map((option) => option.value);

describe("optionsFor", () => {
  it("offers every network for a template that supports them all", () => {
    const options = optionsFor("chain", { template: "minimal" }, ctx);
    expect(options).toEqual([
      { label: "Fuji testnet  ·  recommended", value: "fuji" },
      { label: "C-Chain (mainnet)", value: "c-chain" },
    ]);
  });

  it("offers only Fuji for a Fuji-only template", () => {
    // Mainnet used to be offered for every template, including ones whose
    // deploy can only ever be refused there.
    for (const template of ["nft-mint", "eerc-token"]) {
      expect(optionsFor("chain", { template }, ctx), template).toEqual([
        { label: "Fuji testnet", value: "fuji" },
      ]);
    }
  });

  it("offers every template when no network was chosen up front", () => {
    expect(values(optionsFor("template", {}, ctx))).toEqual(["minimal", "nft-mint", "eerc-token"]);
  });

  it("labels an experimental template in the list, and only that one", () => {
    expect(optionsFor("template", {}, withExperimental)).toEqual([
      { label: "Minimal", value: "minimal" },
      { label: "NFT mint", value: "nft-mint" },
      { label: "Confidential token (eERC)", value: "eerc-token" },
      { label: "Launch your own L1  ·  experimental", value: "l1-launch" },
    ]);
  });

  it("narrows the templates to those that run on a network chosen up front", () => {
    expect(values(optionsFor("template", { chain: "c-chain" }, ctx))).toEqual(["minimal"]);
    expect(values(optionsFor("template", { chain: "fuji" }, ctx))).toEqual([
      "minimal",
      "nft-mint",
      "eerc-token",
    ]);
  });

  it("lists the package managers in the given order and labels the detected one", () => {
    expect(optionsFor("pm", {}, ctx)).toEqual([
      { label: "npm  ·  detected", value: "npm" },
      { label: "pnpm", value: "pnpm" },
      { label: "yarn", value: "yarn" },
      { label: "bun", value: "bun" },
    ]);
    expect(optionsFor("pm", {}, { ...ctx, detectedPackageManager: null })[0]).toEqual({
      label: "npm",
      value: "npm",
    });
  });
});

describe("restrictionNote", () => {
  it("explains a narrowed network list", () => {
    expect(restrictionNote("chain", { template: "nft-mint" }, ctx)).toBe(
      "NFT mint runs on Fuji testnet only.",
    );
    expect(restrictionNote("chain", { template: "minimal" }, ctx)).toBeNull();
  });

  it("explains a narrowed template list", () => {
    expect(restrictionNote("template", { chain: "c-chain" }, ctx)).toBe(
      "Only the templates that run on C-Chain (mainnet) are listed.",
    );
    expect(restrictionNote("template", { chain: "fuji" }, ctx)).toBeNull();
    expect(restrictionNote("template", {}, ctx)).toBeNull();
  });

  it("has nothing to say about the other steps", () => {
    expect(restrictionNote("pm", { template: "nft-mint", chain: "fuji" }, ctx)).toBeNull();
    expect(restrictionNote("projectName", {}, ctx)).toBeNull();
  });
});

describe("templateWarning", () => {
  it("is the chosen experimental template's warning", () => {
    expect(templateWarning({ template: "l1-launch" }, withExperimental)).toBe(
      'Template "l1-launch" is experimental. It needs Avalanche CLI.',
    );
  });

  it("is null before a template is chosen, for a stable one, and for an unknown id", () => {
    expect(templateWarning({}, withExperimental)).toBeNull();
    expect(templateWarning({ chain: "fuji" }, withExperimental)).toBeNull();
    expect(templateWarning({ template: "minimal" }, withExperimental)).toBeNull();
    // A template handed over without the field is stable, too.
    expect(templateWarning({ template: "minimal" }, ctx)).toBeNull();
    expect(templateWarning({ template: "nope" }, withExperimental)).toBeNull();
  });
});

describe("chainLabel", () => {
  it("names the networks the way the wizard shows them", () => {
    expect(chainLabel("fuji")).toBe("Fuji testnet");
    expect(chainLabel("c-chain")).toBe("C-Chain (mainnet)");
  });
});
