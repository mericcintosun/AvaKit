import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import {
  AVAKIT_DEP_VERSION,
  type ChainId,
  listTemplates,
  scaffoldApp,
  type WalletId,
} from "./api.js";
import { banner, bannerColor } from "./banner.js";
import { TELEMETRY_DOCS_URL, Telemetry } from "./telemetry.js";
import type { StartCommand } from "./ui/wizard.js";

// The CLI's own version — read from package.json at runtime (single source of
// truth, can never drift). dist/index.js ships next to package.json.
const VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

// AVAKIT_DEP_VERSION (the @avakit/* range stamped into scaffolded apps) now lives
// in ./api.ts so the CLI and @avakit/mcp share one source of truth.

type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

interface Options {
  projectName?: string;
  template?: string;
  wallet?: WalletId;
  chain?: ChainId;
  pm?: PackageManager;
  yes: boolean;
  local: boolean;
  install: boolean;
  /** Undefined unless --telemetry / --no-telemetry was passed; both persist. */
  telemetry?: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { yes: false, local: false, install: true };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = () => rest[++i];
    switch (arg) {
      case "--yes":
      case "-y":
        opts.yes = true;
        break;
      case "--local":
        opts.local = true;
        break;
      case "--no-install":
        opts.install = false;
        break;
      case "--no-telemetry":
        opts.telemetry = false;
        break;
      case "--telemetry":
        opts.telemetry = true;
        break;
      case "--template":
      case "-t":
        opts.template = next();
        break;
      case "--wallet":
      case "-w":
        opts.wallet = next() as WalletId;
        break;
      case "--chain":
      case "-c":
        opts.chain = next() as ChainId;
        break;
      case "--pm":
        opts.pm = next() as PackageManager;
        break;
      case "--version":
      case "-v":
        process.stdout.write(`${VERSION}\n`);
        process.exit(0);
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg && !arg.startsWith("-") && !opts.projectName) {
          opts.projectName = arg;
        }
    }
  }
  return opts;
}

function printHelp(): void {
  process.stdout.write(
    [
      "create-avalanche-app — scaffold a batteries-included Avalanche dapp",
      "",
      "Usage:  npm create avalanche-app@latest [name] [options]",
      "",
      "Options:",
      "  -t, --template <id>     minimal | nft-mint | token-gated-app | erc20-token |",
      "                          icm-messenger | eerc-token | l1-launch | token-bridge",
      "  -w, --wallet <id>       web3auth | injected   (default: web3auth)",
      "  -c, --chain <id>        fuji | c-chain        (default: fuji)",
      "      --pm <manager>      pnpm | npm | yarn | bun",
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
    ].join("\n"),
  );
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

/** Resolve options without prompting (non-interactive / `--yes` / non-TTY). */
function resolveDefaults(
  opts: Options,
  templateIds: string[],
): Required<Omit<Options, "yes" | "local" | "install" | "telemetry">> {
  return {
    projectName: opts.projectName ?? "my-avax-app",
    template: opts.template && templateIds.includes(opts.template) ? opts.template : "minimal",
    wallet: opts.wallet ?? "web3auth",
    chain: opts.chain ?? "fuji",
    pm: opts.pm ?? "pnpm",
  };
}

function nextSteps(install: boolean, pm: string, projectName: string, template: string): string[] {
  const setup = listTemplates().find((t) => t.id === template)?.setup;
  return [
    `cd ${projectName}`,
    ...(install ? [] : [`${pm} install`]),
    ...(setup ? [`${pm} run ${setup}`] : []),
    `${pm} run dev`,
  ];
}

/** Show the one-time telemetry disclosure, if this user hasn't seen it yet. */
function printFirstRunNotice(telemetry: Telemetry): void {
  const notice = telemetry.firstRunNotice();
  if (notice) process.stdout.write(`${pc.dim(notice.join("\n"))}\n\n`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  const cwd = process.cwd();
  const templates = listTemplates().sort(
    (a, b) => TEMPLATE_ORDER.indexOf(a.id) - TEMPLATE_ORDER.indexOf(b.id),
  );
  const templateIds = templates.map((t) => t.id);

  const telemetry = new Telemetry({
    cliVersion: VERSION,
    ...(opts.telemetry != null ? { flag: opts.telemetry } : {}),
  });

  // The rich Ink UI needs a real terminal; anything else (CI, pipes, --yes) gets
  // a plain, scriptable run.
  const interactive = !opts.yes && Boolean(process.stdin.isTTY);

  if (!interactive) {
    process.stdout.write(banner(bannerColor(process.stdout)));
    printFirstRunNotice(telemetry);
    const r = resolveDefaults(opts, templateIds);
    const targetDir = path.resolve(cwd, r.projectName);
    const choices = { template: r.template, wallet: r.wallet, chain: r.chain, pm: r.pm };
    if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
      telemetry.record({ ...choices, ok: false, errorKind: "dir-exists" });
      await telemetry.flush();
      process.stderr.write(
        pc.red(`\nDirectory "${r.projectName}" already exists and is not empty.\n`),
      );
      process.exit(1);
    }
    try {
      await scaffoldApp({
        projectName: r.projectName,
        targetDir,
        template: r.template,
        wallet: r.wallet,
        chain: r.chain,
        local: opts.local,
        avakitVersion: AVAKIT_DEP_VERSION,
      });
    } catch (error) {
      telemetry.record({ ...choices, ok: false, errorKind: "scaffold-failed" });
      await telemetry.flush();
      throw error;
    }
    telemetry.record({ ...choices, ok: true });
    if (opts.install) spawnSync(r.pm, ["install"], { cwd: targetDir, stdio: "inherit" });
    const steps = nextSteps(opts.install, r.pm, r.projectName, r.template);
    process.stdout.write(`\nDone. Next steps:\n  ${steps.join("\n  ")}\n`);
    await telemetry.flush();
    return;
  }

  printFirstRunNotice(telemetry);

  const { runWizard } = await import("./ui/wizard.js");
  const chosen: { start: StartCommand | null } = { start: null };
  await runWizard({
    version: VERSION,
    templates: templates.map((t) => ({ id: t.id, title: t.title, description: t.description })),
    presets: {
      ...(opts.projectName ? { projectName: opts.projectName } : {}),
      ...(opts.template && templateIds.includes(opts.template) ? { template: opts.template } : {}),
      ...(opts.wallet ? { wallet: opts.wallet } : {}),
      ...(opts.chain ? { chain: opts.chain } : {}),
      ...(opts.pm ? { pm: opts.pm } : {}),
    },
    scaffold: async (a) => {
      const choices = { template: a.template, wallet: a.wallet, chain: a.chain, pm: a.pm };
      const targetDir = path.resolve(cwd, a.projectName);
      if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
        telemetry.record({ ...choices, ok: false, errorKind: "dir-exists" });
        throw new Error(`Directory "${a.projectName}" already exists and is not empty.`);
      }
      try {
        const { files } = await scaffoldApp({
          projectName: a.projectName,
          targetDir,
          template: a.template,
          wallet: a.wallet as WalletId,
          chain: a.chain as ChainId,
          local: opts.local,
          avakitVersion: AVAKIT_DEP_VERSION,
        });
        telemetry.record({ ...choices, ok: true });
        return { created: files.length };
      } catch (error) {
        telemetry.record({ ...choices, ok: false, errorKind: "scaffold-failed" });
        throw error;
      }
    },
    install: opts.install
      ? (a) =>
          spawnSync(a.pm, ["install"], { cwd: path.resolve(cwd, a.projectName), stdio: "ignore" })
            .status === 0
      : null,
    nextSteps: (a) => nextSteps(opts.install, a.pm, a.projectName, a.template),
    // Offer to start the dev server, but only when deps are installed and the
    // template doesn't need a one-time devnet/setup step first.
    startCommand: (a) => {
      if (!opts.install) return null;
      if (templates.find((t) => t.id === a.template)?.setup) return null;
      return {
        command: [a.pm, "run", "dev"],
        cwd: path.resolve(cwd, a.projectName),
        label: `Start the dev server now? (${a.pm} run dev)`,
      };
    },
    onFinish: (start) => {
      chosen.start = start;
    },
  });

  // Before the dev server, not after: `spawnSync` below hands the terminal over
  // and only returns when the user kills it, which could be hours.
  await telemetry.flush();

  // The user opted in — run it for them (inherits the terminal; Ctrl+C stops it).
  const startAfter = chosen.start;
  if (startAfter) {
    const { command, cwd: runCwd } = startAfter;
    process.stdout.write("\n");
    spawnSync(command[0] as string, command.slice(1), { cwd: runCwd, stdio: "inherit" });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `\n${pc.red("Error:")} ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
