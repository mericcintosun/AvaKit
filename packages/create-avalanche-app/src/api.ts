/**
 * Programmatic API for the scaffolder — used by the CLI (src/index.ts) and by
 * @avakit/mcp's `scaffold_app` tool. Keeps template resolution and placeholder
 * replacement in one place.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scaffold } from "./scaffold.js";

/** Web3Auth Modal SDK version. Added to every app — templates always wire the
 * social-login adapter (see the addDependency call below). */
const WEB3AUTH_MODAL_VERSION = "11.2.0";

/**
 * The `@avakit/core` and `@avakit/react` versions stamped into a scaffolded app's
 * package.json (as `^x.y.z`) when not linking locally.
 *
 * Derived per package, never hand-written. Changesets does not link core and
 * react, so they version independently — and one shared number cannot pin two
 * independent packages: pin `@avakit/react@^0.3.0` while react is still 0.2.0 and
 * every scaffold fails at `pnpm install`. The build (tsup) reads each package's
 * real version and substitutes the `__AVAKIT_*_VERSION__` literals below, so the
 * pin is always exactly what shipped.
 *
 * Running from source (tests, `--local`) the literals are undefined, and we read
 * the sibling package.json instead — which only exists inside this monorepo,
 * which is the only place that fallback ever runs.
 */
declare const __AVAKIT_CORE_VERSION__: string;
declare const __AVAKIT_REACT_VERSION__: string;

function siblingVersion(pkg: "core" | "react"): string {
  const p = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    pkg,
    "package.json",
  );
  return (JSON.parse(readFileSync(p, "utf8")) as { version: string }).version;
}

export const AVAKIT_CORE_VERSION =
  typeof __AVAKIT_CORE_VERSION__ === "string" ? __AVAKIT_CORE_VERSION__ : siblingVersion("core");
export const AVAKIT_REACT_VERSION =
  typeof __AVAKIT_REACT_VERSION__ === "string" ? __AVAKIT_REACT_VERSION__ : siblingVersion("react");

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

export type ChainId = "fuji" | "c-chain";

export interface ScaffoldAppOptions {
  projectName: string;
  /** Absolute target directory. */
  targetDir: string;
  template: string;
  chain?: ChainId;
  /** Link @avakit/* via workspace instead of npm versions (repo dev only). */
  local?: boolean;
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

  const local = opts.local ?? false;
  const replacements: Record<string, string> = {
    __PROJECT_NAME__: opts.projectName,
    __CHAIN_CONST__: opts.chain === "c-chain" ? "cChain" : "fuji",
    __AVAKIT_CORE_DEP__: local ? "workspace:*" : `^${AVAKIT_CORE_VERSION}`,
    __AVAKIT_REACT_DEP__: local ? "workspace:*" : `^${AVAKIT_REACT_VERSION}`,
  };

  const files = await scaffold({ templateDir, targetDir: opts.targetDir, replacements });

  // Every template's `providers.tsx` registers all three adapters — burner,
  // injected, and web3auth — so @web3auth/modal (an optional peer of
  // @avakit/core) is always needed at runtime. `web3authAdapter.isAvailable()`
  // is `Boolean(clientId)` against the templates' inlined demo id, so the Social
  // login button always renders enabled; not installing the SDK it dynamic-imports
  // meant it threw on click. Install what the code imports.
  addDependency(
    path.join(opts.targetDir, "package.json"),
    "@web3auth/modal",
    WEB3AUTH_MODAL_VERSION,
  );

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
