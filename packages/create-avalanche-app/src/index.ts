import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
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

function isValidName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/.test(name);
}

async function resolveOptions(
  opts: Options,
): Promise<Required<Omit<Options, "yes" | "local" | "install">>> {
  const templates = listTemplates();
  const templateIds = templates.map((t) => t.id);

  if (opts.yes) {
    const projectName = opts.projectName ?? "my-avax-app";
    return {
      projectName,
      template: opts.template && templateIds.includes(opts.template) ? opts.template : "minimal",
      wallet: opts.wallet ?? "web3auth",
      chain: opts.chain ?? "fuji",
      pm: opts.pm ?? "pnpm",
    };
  }

  p.intro(`${pc.bold("Let's build on Avalanche")} ${pc.dim(`· create-avalanche-app v${VERSION}`)}`);

  // One cohesive group: every prompt is a single unit with a shared cancel
  // handler, and any answer already passed as a flag skips its prompt.
  const answers = await p.group(
    {
      projectName: () =>
        opts.projectName
          ? Promise.resolve(opts.projectName)
          : p.text({
              message: "Project name",
              placeholder: "my-avax-app",
              defaultValue: "my-avax-app",
              validate: (v) =>
                !v || isValidName(v) ? undefined : "Use lowercase letters, digits, - . _",
            }),
      template: () =>
        opts.template
          ? Promise.resolve(opts.template)
          : p.select({
              message: "Template",
              options: templates.map((t) => ({ value: t.id, label: t.title, hint: t.description })),
              initialValue: "minimal",
            }),
      wallet: () =>
        opts.wallet
          ? Promise.resolve(opts.wallet)
          : p.select({
              message: "Wallet",
              options: [
                {
                  value: "web3auth",
                  label: "Social login (Google, Apple, email)",
                  hint: "recommended · works on localhost out of the box",
                },
                { value: "injected", label: "Browser wallet (Core / MetaMask)" },
              ],
              initialValue: "web3auth",
            }),
      chain: () =>
        opts.chain
          ? Promise.resolve(opts.chain)
          : p.select({
              message: "Network",
              options: [
                { value: "fuji", label: "Fuji testnet", hint: "recommended" },
                { value: "c-chain", label: "C-Chain (mainnet)" },
              ],
              initialValue: "fuji",
            }),
      pm: () =>
        opts.pm
          ? Promise.resolve(opts.pm)
          : p.select({
              message: "Package manager",
              options: (["pnpm", "npm", "yarn", "bun"] as const).map((m) => ({
                value: m,
                label: m,
              })),
              initialValue: "pnpm",
            }),
    },
    {
      onCancel: () => {
        p.cancel("Cancelled — no files were written.");
        process.exit(0);
      },
    },
  );

  return {
    projectName: answers.projectName as string,
    template: answers.template as string,
    wallet: answers.wallet as WalletId,
    chain: answers.chain as ChainId,
    pm: answers.pm as PackageManager,
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  // Brand banner — parseArgs has already handled/exited for --version and --help,
  // so this only prints on an actual scaffold run (keeps `-v` clean for scripts).
  process.stdout.write(banner(bannerColor(process.stdout)));
  const resolved = await resolveOptions(opts);

  const targetDir = path.resolve(process.cwd(), resolved.projectName);
  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    const msg = `Directory "${resolved.projectName}" already exists and is not empty.`;
    if (opts.yes) process.stderr.write(pc.red(`\n${msg}\n`));
    else p.cancel(msg);
    process.exit(1);
  }

  const runScaffold = () =>
    scaffoldApp({
      projectName: resolved.projectName,
      targetDir,
      template: resolved.template,
      wallet: resolved.wallet,
      chain: resolved.chain,
      local: opts.local,
      avakitVersion: AVAKIT_DEP_VERSION,
    });
  const runInstall = () =>
    spawnSync(resolved.pm, ["install"], { cwd: targetDir, stdio: opts.yes ? "inherit" : "ignore" });

  if (opts.yes) {
    await runScaffold();
    if (opts.install) runInstall();
  } else {
    // A professional, sequential task list with ticked-off steps.
    let fileCount = 0;
    const taskList = [
      {
        title: "Scaffolding project",
        task: async () => {
          fileCount = (await runScaffold()).files.length;
          return `Created ${fileCount} files`;
        },
      },
    ];
    if (opts.install) {
      taskList.push({
        title: `Installing dependencies with ${resolved.pm}`,
        task: async () => {
          const result = runInstall();
          return result.status === 0
            ? "Dependencies installed"
            : pc.yellow("Install skipped — run it manually");
        },
      });
    }
    await p.tasks(taskList);
  }

  const setup = listTemplates().find((t) => t.id === resolved.template)?.setup;
  const next = [
    `cd ${resolved.projectName}`,
    ...(opts.install ? [] : [`${resolved.pm} install`]),
    ...(setup ? [`${resolved.pm} run ${setup}   # start the local devnet (run once)`] : []),
    `${resolved.pm} run dev`,
  ];

  if (opts.yes) {
    process.stdout.write(`\nDone. Next steps:\n  ${next.join("\n  ")}\n`);
  } else {
    p.note(next.map((s) => pc.cyan(s)).join("\n"), "Next steps");
    p.outro(`${pc.green("✓ Your Avalanche dapp is ready.")}  ${pc.dim("Docs → avakit.dev/docs")}`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `\n${pc.red("Error:")} ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
