import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { type ChainId, listTemplates, scaffoldApp, type WalletId } from "./api.js";

const VERSION = "0.1.0";

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
      "  -t, --template <id>     minimal | nft-mint | token-gated-app | erc20-token",
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

  p.intro(pc.bgCyan(pc.black(" create-avalanche-app ")));

  const projectName =
    opts.projectName ??
    (await p.text({
      message: "Project name?",
      placeholder: "my-avax-app",
      defaultValue: "my-avax-app",
      validate: (v) => (!v || isValidName(v) ? undefined : "Use lowercase letters, digits, - . _"),
    }));
  if (p.isCancel(projectName)) cancel();

  const template =
    opts.template ??
    (await p.select({
      message: "Template?",
      options: templates.map((t) => ({ value: t.id, label: t.title, hint: t.description })),
      initialValue: "minimal",
    }));
  if (p.isCancel(template)) cancel();

  const wallet =
    opts.wallet ??
    (await p.select({
      message: "Wallet provider?",
      options: [
        { value: "web3auth", label: "Social login (Web3Auth)", hint: "free, recommended" },
        { value: "injected", label: "Browser wallet (Core / MetaMask)" },
      ],
      initialValue: "web3auth",
    }));
  if (p.isCancel(wallet)) cancel();

  const chain =
    opts.chain ??
    (await p.select({
      message: "Target chain?",
      options: [
        { value: "fuji", label: "Avalanche Fuji (testnet)", hint: "recommended" },
        { value: "c-chain", label: "Avalanche C-Chain (mainnet)" },
      ],
      initialValue: "fuji",
    }));
  if (p.isCancel(chain)) cancel();

  const pm =
    opts.pm ??
    (await p.select({
      message: "Package manager?",
      options: (["pnpm", "npm", "yarn", "bun"] as const).map((m) => ({ value: m, label: m })),
      initialValue: "pnpm",
    }));
  if (p.isCancel(pm)) cancel();

  return {
    projectName: projectName as string,
    template: template as string,
    wallet: wallet as WalletId,
    chain: chain as ChainId,
    pm: pm as PackageManager,
  };
}

function cancel(): never {
  p.cancel("Cancelled.");
  process.exit(0);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  const resolved = await resolveOptions(opts);

  const targetDir = path.resolve(process.cwd(), resolved.projectName);
  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    process.stderr.write(
      pc.red(`\nDirectory "${resolved.projectName}" already exists and is not empty.\n`),
    );
    process.exit(1);
  }

  const spin = opts.yes ? null : p.spinner();
  spin?.start("Scaffolding project");
  const { files } = await scaffoldApp({
    projectName: resolved.projectName,
    targetDir,
    template: resolved.template,
    wallet: resolved.wallet,
    chain: resolved.chain,
    local: opts.local,
    avakitVersion: VERSION,
  });
  spin?.stop(`Created ${files.length} files`);

  if (opts.install) {
    const installSpin = opts.yes ? null : p.spinner();
    installSpin?.start(`Installing dependencies with ${resolved.pm}`);
    const result = spawnSync(resolved.pm, ["install"], {
      cwd: targetDir,
      stdio: opts.yes ? "inherit" : "ignore",
    });
    if (result.status === 0) {
      installSpin?.stop("Dependencies installed");
    } else {
      installSpin?.stop(pc.yellow("Install skipped/failed — run it manually"));
    }
  }

  const next = [
    `cd ${resolved.projectName}`,
    ...(opts.install ? [] : [`${resolved.pm} install`]),
    ...(resolved.wallet === "web3auth"
      ? ["cp .env.example .env.local   # add your Web3Auth client ID"]
      : []),
    `${resolved.pm} run dev`,
  ];

  if (opts.yes) {
    process.stdout.write(`\nDone. Next steps:\n  ${next.join("\n  ")}\n`);
  } else {
    p.note(next.join("\n"), "Next steps");
    p.outro(pc.green("Your Avalanche dapp is ready."));
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `\n${pc.red("Error:")} ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
