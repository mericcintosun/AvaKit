import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { type ChainId, listTemplates, scaffoldApp, type WalletId } from "./api.js";
import { banner, bannerColor } from "./banner.js";

// The CLI's own version — read from package.json at runtime (single source of
// truth, can never drift). dist/index.js ships next to package.json.
const VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

// The @avakit/* dependency version stamped into scaffolded apps' package.json
// (as `^AVAKIT_DEP_VERSION`). Kept separate from the CLI's own VERSION: it must
// resolve every published @avakit package, so it tracks the LOWEST current
// @avakit version (core 0.1.2 · react 0.1.3 → ^0.1.2 satisfies both). Bump only
// when the minimum @avakit version a fresh app needs goes up.
const AVAKIT_DEP_VERSION = "0.1.2";

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
      "      --local             link @avakit/* via workspace (repo dev only)",
      "  -v, --version           print version",
      "  -h, --help              print this help",
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
): Required<Omit<Options, "yes" | "local" | "install">> {
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

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  const cwd = process.cwd();
  const templates = listTemplates().sort(
    (a, b) => TEMPLATE_ORDER.indexOf(a.id) - TEMPLATE_ORDER.indexOf(b.id),
  );
  const templateIds = templates.map((t) => t.id);

  // The rich Ink UI needs a real terminal; anything else (CI, pipes, --yes) gets
  // a plain, scriptable run.
  const interactive = !opts.yes && Boolean(process.stdin.isTTY);

  if (!interactive) {
    process.stdout.write(banner(bannerColor(process.stdout)));
    const r = resolveDefaults(opts, templateIds);
    const targetDir = path.resolve(cwd, r.projectName);
    if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
      process.stderr.write(
        pc.red(`\nDirectory "${r.projectName}" already exists and is not empty.\n`),
      );
      process.exit(1);
    }
    await scaffoldApp({
      projectName: r.projectName,
      targetDir,
      template: r.template,
      wallet: r.wallet,
      chain: r.chain,
      local: opts.local,
      avakitVersion: AVAKIT_DEP_VERSION,
    });
    if (opts.install) spawnSync(r.pm, ["install"], { cwd: targetDir, stdio: "inherit" });
    const steps = nextSteps(opts.install, r.pm, r.projectName, r.template);
    process.stdout.write(`\nDone. Next steps:\n  ${steps.join("\n  ")}\n`);
    return;
  }

  const { runWizard } = await import("./ui/wizard.js");
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
      const targetDir = path.resolve(cwd, a.projectName);
      if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
        throw new Error(`Directory "${a.projectName}" already exists and is not empty.`);
      }
      const { files } = await scaffoldApp({
        projectName: a.projectName,
        targetDir,
        template: a.template,
        wallet: a.wallet as WalletId,
        chain: a.chain as ChainId,
        local: opts.local,
        avakitVersion: AVAKIT_DEP_VERSION,
      });
      return { created: files.length };
    },
    install: opts.install
      ? (a) =>
          spawnSync(a.pm, ["install"], { cwd: path.resolve(cwd, a.projectName), stdio: "ignore" })
            .status === 0
      : null,
    nextSteps: (a) => nextSteps(opts.install, a.pm, a.projectName, a.template),
  });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `\n${pc.red("Error:")} ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
