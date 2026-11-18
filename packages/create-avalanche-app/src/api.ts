/**
 * Programmatic API for the scaffolder — used by the CLI (src/index.ts) and by
 * @avakit/mcp's `scaffold_app` tool. Keeps template resolution and placeholder
 * replacement in one place.
 */

import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scaffold } from "./scaffold.js";

/** Web3Auth Modal SDK version. Added to every app — templates always wire the
 * social-login adapter (see the addDependency call below). */
const WEB3AUTH_MODAL_VERSION = "11.4.3";

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

/** The chains a template can be scaffolded for. */
export const CHAIN_IDS = ["fuji", "c-chain"] as const;
export type ChainId = (typeof CHAIN_IDS)[number];

export function isChainId(value: unknown): value is ChainId {
  return typeof value === "string" && (CHAIN_IDS as readonly string[]).includes(value);
}

/** The `@avakit/core/chains` export each chain id stands for in a template's source. */
const CHAIN_CONST: Record<ChainId, string> = { fuji: "fuji", "c-chain": "cChain" };

export interface TemplateInfo {
  id: string;
  title: string;
  description: string;
  contracts: boolean;
  /** One-time setup command to run before `dev` (e.g. `pnpm devnet`), if any. */
  setup?: string;
  /**
   * The chains this template can be scaffolded for, from `chains` in its
   * manifest. AvaKit is testnet-first, so a manifest that does not say is
   * Fuji-only: a template has to opt in to mainnet, not out of it.
   */
  chains: ChainId[];
}

type Manifest = Partial<Omit<TemplateInfo, "id" | "chains">> & { chains?: unknown };

/**
 * @param dir The directory holding one folder per template. Defaults to the
 *   templates shipped with this package; a parameter so it can be tested.
 */
export function listTemplates(dir: string = templatesDir): TemplateInfo[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const manifestPath = path.join(dir, e.name, "manifest.json");
      const manifest: Manifest = existsSync(manifestPath)
        ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest)
        : {};
      // Keep only chains we know, in our order. Nothing usable listed — the key
      // is missing, empty, or misspelt — means Fuji only: the safe direction.
      const listed: unknown[] = Array.isArray(manifest.chains) ? manifest.chains : [];
      const chains = CHAIN_IDS.filter((id) => listed.includes(id));
      return {
        id: e.name,
        title: manifest.title ?? e.name,
        description: manifest.description ?? "",
        contracts: manifest.contracts ?? false,
        ...(manifest.setup ? { setup: manifest.setup } : {}),
        chains: chains.length > 0 ? chains : ["fuji"],
      };
    });
}

/**
 * Refuse a chain the template does not list. Without this, asking for C-Chain
 * with a template built for Fuji produced an app that could never work: its
 * Deploy button always refused (no mainnet confirmation is wired), and
 * `eerc-token` pointed a Fuji-only contract address at mainnet.
 */
export function assertChainSupported(
  template: Pick<TemplateInfo, "id" | "chains">,
  chain: string,
): asserts chain is ChainId {
  if (!(template.chains as readonly string[]).includes(chain)) {
    throw new Error(
      `Template "${template.id}" cannot be scaffolded for chain "${chain}". ` +
        `It supports: ${template.chains.join(", ")}.`,
    );
  }
}

export interface ScaffoldAppOptions {
  projectName: string;
  /** Absolute target directory. */
  targetDir: string;
  template: string;
  /** Default "fuji". Must be one of the template's `chains`, or scaffolding is refused. */
  chain?: ChainId;
  /** Link @avakit/* via workspace instead of npm versions (repo dev only). */
  local?: boolean;
}

export interface ScaffoldAppResult {
  targetDir: string;
  files: string[];
}

/**
 * A project name becomes a directory name and is interpolated into the target
 * path, so it must be a single safe path segment. Without this, a value like
 * `../../evil` or an absolute path lets a caller — e.g. an AI agent driving
 * @avakit/mcp under a prompt-injected instruction — write files outside the
 * intended directory. Allow letters, digits, and `. _ -`, start and end
 * alphanumeric; that rejects `..`, leading dots, path separators, and drive
 * prefixes while still permitting names like `my-avax-app` or `app.v2`.
 */
const SAFE_PROJECT_NAME = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

export function assertSafeProjectName(name: string): void {
  if (name.length > 64 || !SAFE_PROJECT_NAME.test(name)) {
    throw new Error(
      `Invalid project name "${name}". Use 1–64 characters: letters, digits, ` +
        `and . _ - (must start and end alphanumeric). No path separators or "..".`,
    );
  }
}

export async function scaffoldApp(opts: ScaffoldAppOptions): Promise<ScaffoldAppResult> {
  // Everything is checked before the first file is written.
  assertSafeProjectName(opts.projectName);
  // Matched against the template list rather than joined into a path, so a
  // value such as "../dist" can never select a directory outside templates/.
  const templates = listTemplates();
  const template = templates.find((t) => t.id === opts.template);
  if (!template) {
    throw new Error(
      `Unknown template "${opts.template}". Available: ${templates.map((t) => t.id).join(", ")}`,
    );
  }
  const chain: string = opts.chain ?? "fuji";
  assertChainSupported(template, chain);
  const templateDir = path.join(templatesDir, template.id);

  const local = opts.local ?? false;
  const replacements: Record<string, string> = {
    __PROJECT_NAME__: opts.projectName,
    __CHAIN_CONST__: CHAIN_CONST[chain],
    __AVAKIT_CORE_DEP__: local ? "workspace:*" : `^${AVAKIT_CORE_VERSION}`,
    __AVAKIT_REACT_DEP__: local ? "workspace:*" : `^${AVAKIT_REACT_VERSION}`,
  };

  // A scaffold that fails part-way (a full disk, a permission error) must not
  // leave a half-written project behind: the retry would find the directory
  // "not empty" and be refused. So what this call wrote is taken away again —
  // the directory itself when this call created it, only its contents when it
  // was already there and empty. One that already held files is left alone:
  // nothing tells theirs from ours.
  const before = targetState(opts.targetDir);
  try {
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
  } catch (error) {
    try {
      if (before === "missing") {
        rmSync(opts.targetDir, { recursive: true, force: true });
      } else if (before === "empty") {
        for (const entry of readdirSync(opts.targetDir)) {
          rmSync(path.join(opts.targetDir, entry), { recursive: true, force: true });
        }
      }
    } catch {
      // Tidying up failed too. The error worth reporting is still the first one.
    }
    throw error;
  }
}

/** What is at `target` before anything is written: nothing, an empty directory, or more. */
function targetState(target: string): "missing" | "empty" | "occupied" {
  try {
    // lstat, so that a symlink pointing nowhere counts as something being there.
    lstatSync(target);
  } catch {
    return "missing";
  }
  try {
    return readdirSync(target).length === 0 ? "empty" : "occupied";
  } catch {
    // Not a directory, or not one we can read: nothing of ours to tidy up later.
    return "occupied";
  }
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
