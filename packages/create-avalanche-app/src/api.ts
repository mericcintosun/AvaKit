/**
 * Programmatic API for the scaffolder — used by the CLI (src/index.ts) and by
 * @avakit/mcp's `scaffold_app` tool. Keeps template resolution and placeholder
 * replacement in one place.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scaffold } from "./scaffold.js";

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
    __AVAKIT_DEP__: opts.local ? "workspace:*" : `^${opts.avakitVersion ?? "0.1.0"}`,
  };

  const files = await scaffold({ templateDir, targetDir: opts.targetDir, replacements });
  return { targetDir: opts.targetDir, files };
}
