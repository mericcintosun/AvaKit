/**
 * Avalanche-specific environment inventory. Read-only: it detects the tools and
 * local L1s a developer has, so the Studio home can show what's ready and what
 * to install. No shell strings — every external call is execFile with fixed args.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function firstLine(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await exec(cmd, args, { timeout: 5000 });
    return stdout.trim().split("\n")[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

export interface ToolInfo {
  name: string;
  installed: boolean;
  version: string | null;
  /** Install command, shown when the tool is missing. */
  hint?: string;
}

export interface ProjectInfo {
  isAvaKit: boolean;
  name: string | null;
  /** "icm-messenger" when detected, else null. */
  template: string | null;
  hasContracts: boolean;
}

export interface Inventory {
  cwd: string;
  tools: ToolInfo[];
  project: ProjectInfo;
  /** Local L1s known to avalanche-cli (by name). */
  localL1s: string[];
}

function detectProject(cwd: string): ProjectInfo {
  const pkgPath = path.join(cwd, "package.json");
  let isAvaKit = false;
  let name: string | null = null;
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      name = pkg.name ?? null;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      isAvaKit = Object.keys(deps).some((d) => d.startsWith("@avakit/"));
    } catch {
      // unreadable package.json
    }
  }
  return {
    isAvaKit,
    name,
    template: existsSync(path.join(cwd, "icm.config.json")) ? "icm-messenger" : null,
    hasContracts: existsSync(path.join(cwd, "contracts", "foundry.toml")),
  };
}

function listLocalL1s(): string[] {
  const dir = path.join(homedir(), ".avalanche-cli", "subnets");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export async function getInventory(cwd: string): Promise<Inventory> {
  const [avalanche, forge, cast] = await Promise.all([
    firstLine("avalanche", ["--version"]),
    firstLine("forge", ["--version"]),
    firstLine("cast", ["--version"]),
  ]);

  const tools: ToolInfo[] = [
    {
      name: "avalanche-cli",
      installed: avalanche !== null,
      version: avalanche,
      hint: "curl -sSfL https://raw.githubusercontent.com/ava-labs/avalanche-cli/main/scripts/install.sh | sh -s -- -b /usr/local/bin",
    },
    {
      name: "Foundry (forge)",
      installed: forge !== null,
      version: forge,
      hint: "curl -L https://foundry.paradigm.xyz | bash && foundryup",
    },
    { name: "Foundry (cast)", installed: cast !== null, version: cast },
    { name: "Node.js", installed: true, version: process.version },
  ];

  return {
    cwd,
    tools,
    project: detectProject(cwd),
    localL1s: listLocalL1s(),
  };
}
