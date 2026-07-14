/**
 * Programmatic API for the scaffolder — used by the CLI (src/index.ts) and by
 * @avakit/mcp's `scaffold_app` tool. Keeps template resolution and placeholder
 * replacement in one place.
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scaffold } from "./scaffold.js";

/** Web3Auth Modal SDK version added to apps that use the social-login wallet. */
const WEB3AUTH_MODAL_VERSION = "11.2.0";

/**
 * The `@avakit/*` version range stamped into a scaffolded app's package.json (as
 * `^AVAKIT_DEP_VERSION`) when not linking locally. Single source of truth shared
 * by the CLI and `@avakit/mcp`, so both scaffolding paths pin the same version.
 * Bump on every `@avakit/core`/`react` release whose features the templates rely
 * on (0.1.7 added the burner wallet the default templates wire up).
 */
export const AVAKIT_DEP_VERSION = "0.1.7";

export const templatesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
);

export interface TemplateInfo {
  id: string;
  title: string;
  description: string;
  contracts: boolean;
  /** One-time setup command to run before `dev` (e.g. `pnpm devnet`), if any. */
  setup?: string;
}

export function listTemplates(): TemplateInfo[] {
  return readdirSync(templatesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const manifestPath = path.join(templatesDir, e.name, "manifest.json");
      const manifest = existsSync(manifestPath)
        ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<TemplateInfo>)
        : {};
      return {
        id: e.name,
        title: manifest.title ?? e.name,
        description: manifest.description ?? "",
        contracts: manifest.contracts ?? false,
        ...(manifest.setup ? { setup: manifest.setup } : {}),
      };
    });
}

export type WalletId = "web3auth" | "injected";
export type ChainId = "fuji" | "c-chain";

export interface ScaffoldAppOptions {
  projectName: string;
  /** Absolute target directory. */
  targetDir: string;
  template: string;
  wallet?: WalletId;
  chain?: ChainId;
  /** Link @avakit/* via workspace instead of npm versions (repo dev only). */
  local?: boolean;
  /** @avakit version range used when not linking locally. */
  avakitVersion?: string;
}

export interface ScaffoldAppResult {
  targetDir: string;
  files: string[];
}

export async function scaffoldApp(opts: ScaffoldAppOptions): Promise<ScaffoldAppResult> {
  const templateDir = path.join(templatesDir, opts.template);
  if (!existsSync(templateDir)) {
    throw new Error(
      `Unknown template "${opts.template}". Available: ${listTemplates()
        .map((t) => t.id)
        .join(", ")}`,
    );
  }

  const replacements: Record<string, string> = {
    __PROJECT_NAME__: opts.projectName,
    __CHAIN_CONST__: opts.chain === "c-chain" ? "cChain" : "fuji",
    __AVAKIT_DEP__: opts.local ? "workspace:*" : `^${opts.avakitVersion ?? AVAKIT_DEP_VERSION}`,
  };

  let files = await scaffold({ templateDir, targetDir: opts.targetDir, replacements });

  // The social-login wallet needs @web3auth/modal (an optional peer of
  // @avakit/core). Add it to the app so `web3authAdapter` can load at runtime.
  if (opts.wallet === "web3auth") {
    addDependency(
      path.join(opts.targetDir, "package.json"),
      "@web3auth/modal",
      WEB3AUTH_MODAL_VERSION,
    );
  }

  // The only env var in `.env.example` is the Web3Auth client id, which the
  // injected-wallet path never reads — drop the file so it isn't dead noise.
  if (opts.wallet === "injected") {
    const envExample = path.join(opts.targetDir, ".env.example");
    if (existsSync(envExample)) {
      rmSync(envExample);
      files = files.filter((f) => f !== ".env.example");
    }
  }

  return { targetDir: opts.targetDir, files };
}

function addDependency(pkgPath: string, name: string, version: string): void {
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  pkg.dependencies = Object.fromEntries(
    Object.entries({ ...pkg.dependencies, [name]: version }).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}
