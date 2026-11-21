/**
 * What the wizard offers at each step. Kept apart from the Ink components so the
 * rules — above all "only offer a chain the template supports" — are plain
 * functions that can be tested directly.
 */

import { CHAIN_IDS } from "../api.js";

export type Answers = {
  projectName: string;
  template: string;
  chain: string;
  pm: string;
};
export type StepKey = keyof Answers;

/** The order the questions are asked in. */
export const STEP_ORDER: StepKey[] = ["projectName", "template", "chain", "pm"];

export type TemplateInfo = {
  id: string;
  title: string;
  description: string;
  /** The chains this template can be scaffolded for. */
  chains: string[];
  /**
   * For an experimental template, the one line to show once it is chosen (the
   * scaffolder's `experimentalWarning`); it is also labelled in the list.
   * Null or absent for a stable template.
   */
  warning?: string | null;
};

export type StepContext = {
  templates: TemplateInfo[];
  /** The package managers to offer, in display order (the first is the default). */
  packageManagers: string[];
  /** The manager the CLI was launched with, if known — labelled in the list. */
  detectedPackageManager: string | null;
};

export type Option = { label: string; value: string };

export function chainLabel(id: string): string {
  return id === "c-chain" ? "C-Chain (mainnet)" : "Fuji testnet";
}

/** The chains the chosen template supports (every chain, until one is chosen). */
function chainsFor(answers: Partial<Answers>, ctx: StepContext): string[] {
  const template = ctx.templates.find((t) => t.id === answers.template);
  return CHAIN_IDS.filter((id) => !template || template.chains.includes(id));
}

/** The templates that can be scaffolded for the chain picked so far (all, if none). */
function templatesFor(answers: Partial<Answers>, ctx: StepContext): TemplateInfo[] {
  const { chain } = answers;
  return ctx.templates.filter((t) => chain === undefined || t.chains.includes(chain));
}

/**
 * The choices for a list step, given what has been answered so far. A choice
 * that cannot work with an earlier answer is not offered at all, so the wizard
 * can never assemble a template-and-chain pair the scaffolder would refuse.
 */
export function optionsFor(key: StepKey, answers: Partial<Answers>, ctx: StepContext): Option[] {
  switch (key) {
    case "template":
      // An experimental template says so in the list, before it is picked.
      return templatesFor(answers, ctx).map((t) => ({
        label: t.warning ? `${t.title}  ·  experimental` : t.title,
        value: t.id,
      }));
    case "chain": {
      const chains = chainsFor(answers, ctx);
      return chains.map((id) => ({
        // "recommended" only means something when there is an alternative.
        label:
          id === "fuji" && chains.length > 1 ? `${chainLabel(id)}  ·  recommended` : chainLabel(id),
        value: id,
      }));
    }
    case "pm":
      return ctx.packageManagers.map((m) => ({
        label: m === ctx.detectedPackageManager ? `${m}  ·  detected` : m,
        value: m,
      }));
    default:
      return [];
  }
}

/**
 * A line explaining why a step offers fewer choices than usual, or null when
 * nothing was left out. Shown under the list, so a narrowed list is never a
 * silent one.
 */
export function restrictionNote(
  key: StepKey,
  answers: Partial<Answers>,
  ctx: StepContext,
): string | null {
  if (key === "chain") {
    const chains = chainsFor(answers, ctx);
    if (chains.length === CHAIN_IDS.length) return null;
    const template = ctx.templates.find((t) => t.id === answers.template);
    return `${template?.title ?? "This template"} runs on ${chains.map(chainLabel).join(" and ")} only.`;
  }
  if (key === "template" && answers.chain !== undefined) {
    if (templatesFor(answers, ctx).length === ctx.templates.length) return null;
    return `Only the templates that run on ${chainLabel(answers.chain)} are listed.`;
  }
  return null;
}

/**
 * The warning for the template chosen so far, or null when none is chosen yet
 * or the chosen one is stable. Shown with the answers from then on, so it is
 * still on screen at "Create the app now?".
 */
export function templateWarning(answers: Partial<Answers>, ctx: StepContext): string | null {
  if (answers.template === undefined) return null;
  return ctx.templates.find((t) => t.id === answers.template)?.warning ?? null;
}
