/**
 * The create-avalanche-app command, as a function: `run()` takes everything it
 * would otherwise read from the process (arguments, environment, streams) and
 * returns the exit code, so the whole flow can be tested without spawning the
 * built binary. `index.ts` is the thin entry that feeds it the real process.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import {
  assertChainSupported,
  assertSafeProjectName,
  type ChainId,
  listTemplates,
  scaffoldApp,
  type TemplateInfo,
} from "./api.js";
import { type CliOptions, parseArgs, UsageError } from "./args.js";
import { banner, bannerColor } from "./banner.js";
import {
  DEFAULT_PACKAGE_MANAGER,
  detectPackageManager,
  isPackageManager,
  PACKAGE_MANAGERS,
  type PackageManager,
  type RunResult,
  runPackageManager,
  runPackageManagerQuietly,
} from "./pm.js";
import { TELEMETRY_DOCS_URL, Telemetry } from "./telemetry.js";
import type { WizardResult } from "./ui/wizard.js";

// The CLI's own version — read from package.json at runtime (single source of
// truth, can never drift). dist/index.js ships next to package.json.
const VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

interface Output {
  write(text: string): unknown;
  isTTY?: boolean;
}

export interface CliContext {
  /** The arguments after the node binary and the script path. */
  argv: readonly string[];
  cwd: string;
  /**
   * The environment: which package manager launched us, the telemetry settings,
   * and what the commands we start inherit. Nothing below reads `process.env`
   * for those, so a caller that passes its own decides all three.
   */
  env: NodeJS.ProcessEnv;
  stdout: Output;
  stderr: Output;
  /** Whether stdin is a terminal — the interactive wizard needs one. */
  stdinIsTTY: boolean;
  platform: NodeJS.Platform;
}

function helpText(templates: readonly TemplateInfo[]): string {
  // From the manifests, so the help cannot drift from what is actually allowed.
  const mainnetTemplates = templates
    .filter((t) => t.chains.includes("c-chain"))
    .map((t) => t.id)
    .join(", ");
  return [
    "create-avalanche-app — scaffold a batteries-included Avalanche dapp",
    "",
    "Usage:  npm create avalanche-app@latest [name] [options]",
    "",
    "Options:",
    "  -t, --template <id>     minimal | nft-mint | token-gated-app | erc20-token |",
    "                          icm-messenger | eerc-token | l1-launch | token-bridge",
    "  -c, --chain <id>        fuji | c-chain        (default: fuji)",
    `                          c-chain (mainnet) only with: ${mainnetTemplates || "no template"}`,
    `      --pm <manager>      ${PACKAGE_MANAGERS.join(" | ")}`,
    "                          (default: the one you ran this with, else npm)",
    "  -y, --yes               skip prompts (non-interactive)",
    "      --no-install        do not install dependencies",
    "      --no-telemetry      opt out of anonymous usage counting (persisted)",
    "      --telemetry         opt back in (persisted)",
    "      --local             link @avakit/* via workspace (repo dev only)",
    "  -v, --version           print version",
    "  -h, --help              print this help",
    "",
    "Telemetry:",
    "  Anonymous, opt-out, never sends project names, paths, or code.",
    `  Off via --no-telemetry, AVAKIT_TELEMETRY_DISABLED=1, or DO_NOT_TRACK=1.`,
    `  ${TELEMETRY_DOCS_URL}`,
    "",
  ].join("\n");
}

// Curated display order — starters first, advanced/niche templates last — so the
// list reads intentionally instead of alphabetically (and the default lands on a
// sensible starter, not a niche one).
const TEMPLATE_ORDER = [
  "minimal",
  "nft-mint",
  "token-gated-app",
  "erc20-token",
  "icm-messenger",
  "token-bridge",
  "eerc-token",
  "l1-launch",
];

/**
 * Resolve options without prompting (non-interactive / `--yes` / non-TTY).
 * Everything in `opts` is already validated, so a default only ever stands in
 * for a flag that was not passed — never for one that was wrong.
 */
function resolveDefaults(
  opts: CliOptions,
  templates: readonly TemplateInfo[],
  detectedPm: PackageManager | null,
): { projectName: string; template: string; chain: ChainId; pm: PackageManager } {
  const resolved = {
    projectName: opts.projectName ?? "my-avax-app",
    template: opts.template ?? "minimal",
    chain: opts.chain ?? "fuji",
    pm: opts.pm ?? detectedPm ?? DEFAULT_PACKAGE_MANAGER,
  };
  // The defaults complete the selection, so the pair is checked once more: a
  // default must never be how an unsupported template-and-chain gets through.
  const template = templates.find((t) => t.id === resolved.template);
  if (template) {
    try {
      assertChainSupported(template, resolved.chain);
    } catch (error) {
      throw new UsageError(error instanceof Error ? error.message : String(error));
    }
  }
  return resolved;
}

/** Why nothing can be scaffolded into `targetDir` (shown as `name`), or null when it is free. */
function occupied(name: string, targetDir: string): string | null {
  if (!existsSync(targetDir)) return null;
  if (!statSync(targetDir).isDirectory()) return `"${name}" already exists and is not a directory.`;
  if (readdirSync(targetDir).length > 0) {
    return `Directory "${name}" already exists and is not empty.`;
  }
  return null;
}

/**
 * Why `name` cannot be the project directory, or null when it can. The one rule
 * for a name wherever it comes from: the command line, the wizard's prompt, or
 * the API (which enforces the same `assertSafeProjectName`).
 */
export function projectNameProblem(name: string, cwd: string): string | null {
  try {
    assertSafeProjectName(name);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return occupied(name, path.resolve(cwd, name));
}

/**
 * What the user still has to run by hand.
 *
 * @param installed Whether the dependencies are in place. False both when the
 *   install was skipped (`--no-install`) and when it was attempted and failed —
 *   in either case the install command belongs in the list.
 */
export function nextSteps(
  installed: boolean,
  pm: string,
  projectName: string,
  template: string,
): string[] {
  const setup = listTemplates().find((t) => t.id === template)?.setup;
  return [
    `cd ${projectName}`,
    ...(installed ? [] : [`${pm} install`]),
    ...(setup ? [`${pm} run ${setup}`] : []),
    `${pm} run dev`,
  ];
}

/** The shell's status for a command the user stopped with Ctrl+C (128 + SIGINT). */
export const INTERRUPTED_EXIT_CODE = 130;

/** How the wizard ended. A type import only: the UI itself is loaded on demand. */
export type WizardOutcome = WizardResult["outcome"];

/** What the wizard's callbacks had done when it ended, as the CLI saw it. */
export interface WizardProgress {
  /** The project's directory name once scaffolding has started writing it; null before. */
  projectName: string | null;
  /** Whether that scaffold finished. */
  scaffolded: boolean;
  /** Whether the install succeeded; null when none ran to the end (skipped or not reached). */
  installed: boolean | null;
}

/**
 * The exit code for how the wizard ended, and the one line (if any) that tells
 * the user what is on disk.
 *
 * - `failed`: 1. The wizard has already shown the error.
 * - `declined`: 0. The user answered No to "Create the app now?"; nothing exists.
 * - `interrupted`: 130, the shell's code for Ctrl+C, whatever was done by then, so
 *   a `&&` chain stops. The line says whether a project directory exists.
 * - `created`: 0, or 1 when the install failed (the wizard has said so).
 *
 * `toStderr` is true for the line of an unsuccessful run.
 */
export function wizardExit(
  outcome: WizardOutcome,
  progress: WizardProgress,
): { code: number; line: string | null; toStderr: boolean } {
  if (outcome === "failed") return { code: 1, line: null, toStderr: true };
  if (outcome === "declined") return { code: 0, line: "Nothing was created.", toStderr: false };
  if (outcome === "interrupted") {
    const dir = progress.projectName === null ? null : `./${progress.projectName}`;
    let line: string;
    if (dir === null) line = "Cancelled. Nothing was created.";
    else if (!progress.scaffolded) {
      line = `Cancelled while ${dir} was being created: its files may be incomplete.`;
    } else if (progress.installed === true) {
      line = `Cancelled. The project was created in ${dir} and its dependencies are installed.`;
    } else {
      line = `Cancelled. The project was created in ${dir}, but its dependencies are not installed.`;
    }
    return { code: INTERRUPTED_EXIT_CODE, line, toStderr: true };
  }
  return { code: progress.installed === false ? 1 : 0, line: null, toStderr: false };
}

/** Show the one-time telemetry disclosure, if this user hasn't seen it yet. */
function printFirstRunNotice(telemetry: Telemetry, stdout: Output): void {
  const notice = telemetry.firstRunNotice();
  if (notice) stdout.write(`${pc.dim(notice.join("\n"))}\n\n`);
}

/** The line that tells the user how to get past a failed install, if we know. */
function installHint(install: RunResult, pm: PackageManager): string[] {
  if (install.failure === "not-found") {
    return [
      `Install ${pm} first, or pick a package manager you have with --pm (${PACKAGE_MANAGERS.join(" | ")}).`,
    ];
  }
  // It ran with the terminal attached, so its own output is right above.
  if (install.failure === "exit-code") return [`See the ${pm} output above for the cause.`];
  return [];
}

async function main(ctx: CliContext): Promise<number> {
  const templates = listTemplates().sort(
    (a, b) => TEMPLATE_ORDER.indexOf(a.id) - TEMPLATE_ORDER.indexOf(b.id),
  );
  const parsed = parseArgs(ctx.argv, templates);
  if (parsed.command === "help") {
    ctx.stdout.write(helpText(templates));
    return 0;
  }
  if (parsed.command === "version") {
    ctx.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const opts = parsed.options;
  const { cwd } = ctx;
  // The package manager the user launched us with (`npm create`, `pnpm create`,
  // `yarn create`, `bun create`) is one they certainly have, so it is the default.
  const detectedPm = detectPackageManager(ctx.env.npm_config_user_agent);
  const runOptions = { env: ctx.env, platform: ctx.platform };

  // The rich Ink UI needs a real terminal; anything else (CI, pipes, --yes) gets
  // a plain, scriptable run.
  const interactive = !opts.yes && ctx.stdinIsTTY;
  // Resolved before anything is printed or recorded, so a selection that cannot
  // be scaffolded fails as a plain usage error.
  const defaults = interactive ? null : resolveDefaults(opts, templates, detectedPm);

  // From the environment this run was given, like everything else here: a run
  // inside a test must never be switched on, or pointed at the real collector,
  // by whatever the surrounding process happens to have set.
  const telemetry = new Telemetry({
    cliVersion: VERSION,
    env: ctx.env,
    ...(opts.telemetry != null ? { flag: opts.telemetry } : {}),
  });

  if (defaults) {
    ctx.stdout.write(banner(bannerColor(ctx.stdout)));
    printFirstRunNotice(telemetry, ctx.stdout);
    const r = defaults;
    const targetDir = path.resolve(cwd, r.projectName);
    const choices = { template: r.template, chain: r.chain, pm: r.pm };
    const taken = occupied(r.projectName, targetDir);
    if (taken) {
      telemetry.record({ ...choices, ok: false, errorKind: "dir-exists" });
      await telemetry.flush();
      ctx.stderr.write(pc.red(`\n${taken}\n`));
      return 1;
    }
    try {
      await scaffoldApp({
        projectName: r.projectName,
        targetDir,
        template: r.template,
        chain: r.chain,
        local: opts.local,
      });
    } catch (error) {
      telemetry.record({ ...choices, ok: false, errorKind: "scaffold-failed" });
      await telemetry.flush();
      throw error;
    }
    telemetry.record({ ...choices, ok: true });

    const install = opts.install
      ? runPackageManager(r.pm, ["install"], { cwd: targetDir, ...runOptions })
      : null;

    if (install && !install.ok) {
      // The app exists but cannot run yet. Say so and fail: a script that chains
      // on `&&` must not carry on as if the install had worked.
      const steps = nextSteps(false, r.pm, r.projectName, r.template);
      ctx.stderr.write(
        [
          "",
          `${pc.red("Error:")} Dependencies were not installed: ${install.reason}.`,
          ...installHint(install, r.pm),
          "",
          `The project was created in ./${r.projectName}. To finish the setup yourself:`,
          `  ${steps.join("\n  ")}`,
          "",
        ].join("\n"),
      );
      await telemetry.flush();
      return 1;
    }

    const steps = nextSteps(install !== null, r.pm, r.projectName, r.template);
    ctx.stdout.write(`\nDone. Next steps:\n  ${steps.join("\n  ")}\n`);
    await telemetry.flush();
    return 0;
  }

  // A name given on the command line skips the wizard's own prompt, so check it
  // here — before any question is asked, not after all of them.
  if (opts.projectName !== undefined) {
    const problem = projectNameProblem(opts.projectName, cwd);
    if (problem) throw new Error(problem);
  }

  printFirstRunNotice(telemetry, ctx.stdout);

  const { runWizard } = await import("./ui/wizard.js");
  const pmOf = (value: string): PackageManager => {
    // The wizard only ever offers the known managers; this guards the invariant.
    if (!isPackageManager(value)) throw new Error(`Unknown package manager "${value}".`);
    return value;
  };
  // With nothing detected, lead with the manager the plain run falls back to.
  const preferredPm = detectedPm ?? DEFAULT_PACKAGE_MANAGER;
  // Kept by the callbacks below, so that however the wizard ends, the exit code
  // and the last line can say what is on disk.
  const progress: WizardProgress = { projectName: null, scaffolded: false, installed: null };
  const result = await runWizard({
    version: VERSION,
    templates: templates.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      chains: t.chains,
    })),
    // First in the list is what a bare Enter picks.
    packageManagers: [preferredPm, ...PACKAGE_MANAGERS.filter((m) => m !== preferredPm)],
    detectedPackageManager: detectedPm,
    presets: {
      ...(opts.projectName ? { projectName: opts.projectName } : {}),
      ...(opts.template ? { template: opts.template } : {}),
      ...(opts.chain ? { chain: opts.chain } : {}),
      ...(opts.pm ? { pm: opts.pm } : {}),
    },
    validateName: (name) => projectNameProblem(name, cwd),
    scaffold: async (a) => {
      const choices = { template: a.template, chain: a.chain, pm: a.pm };
      const targetDir = path.resolve(cwd, a.projectName);
      const taken = occupied(a.projectName, targetDir);
      if (taken) {
        telemetry.record({ ...choices, ok: false, errorKind: "dir-exists" });
        throw new Error(taken);
      }
      progress.projectName = a.projectName;
      try {
        const { files } = await scaffoldApp({
          projectName: a.projectName,
          targetDir,
          template: a.template,
          chain: a.chain as ChainId,
          local: opts.local,
        });
        progress.scaffolded = true;
        telemetry.record({ ...choices, ok: true });
        return { created: files.length };
      } catch (error) {
        telemetry.record({ ...choices, ok: false, errorKind: "scaffold-failed" });
        throw error;
      }
    },
    install: opts.install
      ? async (a) => {
          const install = await runPackageManagerQuietly(pmOf(a.pm), ["install"], {
            cwd: path.resolve(cwd, a.projectName),
            ...runOptions,
          });
          progress.installed = install.ok;
          return install;
        }
      : null,
    nextSteps: (a, installed) => nextSteps(installed, a.pm, a.projectName, a.template),
    // Offer to start the dev server, but only when the dependencies really are
    // installed and the template doesn't need a one-time devnet/setup step first.
    startCommand: (a, installed) => {
      if (!installed) return null;
      if (templates.find((t) => t.id === a.template)?.setup) return null;
      return {
        pm: pmOf(a.pm),
        args: ["run", "dev"],
        cwd: path.resolve(cwd, a.projectName),
        label: `Start the dev server now? (${a.pm} run dev)`,
      };
    },
  });

  // Before the dev server, not after: `runPackageManager` below hands the
  // terminal over and only returns when the user stops it, which could be hours.
  await telemetry.flush();

  // Failed, declined or interrupted: done here, with the line that says what
  // exists. Ctrl+C at a prompt reaches the wizard as a key press rather than as
  // SIGINT, so this is where it becomes the 130 a killed command would give.
  const ending = wizardExit(result.outcome, progress);
  if (ending.line) {
    (ending.toStderr ? ctx.stderr : ctx.stdout).write(`\n${ending.line}\n`);
  }
  if (result.outcome !== "created") return ending.code;

  // The user opted in — run it for them (inherits the terminal; Ctrl+C stops it).
  if (result.start) {
    const { pm, args, cwd: runCwd } = result.start;
    ctx.stdout.write("\n");
    const dev = runPackageManager(pm, args, { cwd: runCwd, ...runOptions });
    if (!dev.ok) {
      // A dev server that ran and then stopped has already said why. One that
      // never started has said nothing, so that case needs our own message.
      if (dev.failure === "not-found" || dev.failure === "not-started") {
        ctx.stderr.write(`\n${pc.red("Error:")} Could not start the dev server: ${dev.reason}.\n`);
      }
      return dev.status || 1;
    }
  }

  // The wizard has already told the user that the install failed and what to
  // run; the exit code is how a wrapping script finds out.
  return ending.code;
}

export async function run(ctx: CliContext): Promise<number> {
  try {
    return await main(ctx);
  } catch (error) {
    ctx.stderr.write(
      `\n${pc.red("Error:")} ${error instanceof Error ? error.message : String(error)}\n`,
    );
    if (error instanceof UsageError) {
      ctx.stderr.write("Run with --help to see the available options.\n");
    }
    return 1;
  }
}
