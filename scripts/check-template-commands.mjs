// Fail when a create-avalanche-app template tells its reader to run a command
// through pnpm, yarn or bun.
//
// `npm create avalanche-app` installs with the package manager that launched
// it, npm by default, and the release is advertised for a machine that has
// Node.js and npm and nothing else. On that machine `pnpm dev` does not exist,
// so every command a scaffolded app shows its user or its coding agent (README,
// CLAUDE.md, llms.txt, script hints, copy buttons in the UI) is written for npm:
// `npm install`, `npm run dev`, `npm run devnet`. A pnpm, yarn or bun user knows
// the equivalent; an npm user cannot run a pnpm command.
//
// The check reads every text file under the templates directory and reports a
// line that runs a package script or an install through pnpm, yarn or bun
// (`pnpm dev`, `pnpm run devnet`, `pnpm install`, `yarn dev`, `bun run dev`,
// ...). Prose that only names the tools ("pnpm, yarn and bun work as well") is
// not a command and passes. The few lines that are about pnpm on purpose are
// listed in ALLOWED with the reason.
//
// Usage: node scripts/check-template-commands.mjs [templates-dir]

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATES_DIR = resolve(here, "..", "packages", "create-avalanche-app", "templates");

/** Directories a template never ships but a local run may leave behind. */
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "out"]);

/**
 * Package-manager subcommands that install or run something. Each template's own
 * package.json scripts are added to these, so `pnpm devnet` is caught in the
 * template that has a `devnet` script.
 */
const SUBCOMMANDS = new Set([
  "add",
  "build",
  "ci",
  "create",
  "dev",
  "dlx",
  "exec",
  "i",
  "install",
  "remove",
  "run",
  "start",
  "test",
  "typecheck",
  "x",
]);

/**
 * Lines that name a pnpm command on purpose. `file` is matched against the path
 * relative to the templates directory (with `/` separators), `line` against the
 * line's text.
 */
export const ALLOWED = [
  {
    file: /(^|\/)pnpm-workspace\.yaml$/,
    line: /^\s*#/,
    why:
      "pnpm-workspace.yaml is read only by pnpm; its comments explain how it keeps " +
      "`pnpm install` / `pnpm dev` from failing for people who do install with pnpm.",
  },
];

// The tool name, not part of a longer word or path (`ERR_PNPM`, `pnpm-workspace`,
// `@pnpm/x`), then whitespace and the word that follows it.
const COMMAND = /(?<![\w./@-])(pnpm|yarn|bun)\s+([A-Za-z][\w:.-]*)/g;

/** The templates in `templatesDir`: its sub-directories that have a package.json. */
export function listTemplates(templatesDir) {
  return readdirSync(templatesDir)
    .filter((name) => existsSync(join(templatesDir, name, "package.json")))
    .sort();
}

/** Every file under `dir`, recursively, skipping build output and installs. */
function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : listFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

/** The npm form of a command, to suggest in the report. */
function npmEquivalent(subcommand, script) {
  if (subcommand === "install" || subcommand === "i") return "npm install";
  if (subcommand === "run" && script) return `npm run ${script}`;
  if (subcommand === "dlx" || subcommand === "x") return "npx";
  return `npm run ${subcommand}`;
}

/**
 * The pnpm, yarn and bun commands in the templates:
 * `[{ file, line, text, command, npm }]`, `file` relative to `templatesDir`.
 */
export function findCommands(templatesDir) {
  const found = [];
  let files = 0;
  for (const template of listTemplates(templatesDir)) {
    const root = join(templatesDir, template);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const commands = new Set([...SUBCOMMANDS, ...Object.keys(pkg.scripts ?? {})]);

    for (const path of listFiles(root)) {
      const content = readFileSync(path);
      if (content.includes(0)) continue; // binary
      files++;
      const file = relative(templatesDir, path).split(sep).join("/");
      const lines = content.toString("utf8").split(/\r?\n/);
      lines.forEach((text, index) => {
        if (ALLOWED.some((allow) => allow.file.test(file) && allow.line.test(text))) return;
        for (const match of text.matchAll(COMMAND)) {
          // A sentence may end right after the command: "re-run pnpm l1."
          const subcommand = match[2].replace(/[.:-]+$/, "");
          if (!commands.has(subcommand)) continue;
          const script =
            subcommand === "run"
              ? text
                  .slice(match.index + match[0].length)
                  .match(/^\s+([A-Za-z][\w:-]*)/)?.[1]
                  ?.replace(/[:-]+$/, "")
              : undefined;
          found.push({
            file,
            line: index + 1,
            text: text.trim(),
            command: script ? `${match[1]} run ${script}` : `${match[1]} ${subcommand}`,
            npm: npmEquivalent(subcommand, script),
          });
        }
      });
    }
  }
  return { found, files };
}

function main() {
  const templatesDir = resolve(process.argv[2] ?? DEFAULT_TEMPLATES_DIR);

  // A check that reads nothing must not pass: that is what a moved or renamed
  // templates directory would look like.
  const templates = existsSync(templatesDir) ? listTemplates(templatesDir) : [];
  if (templates.length === 0) {
    console.error(`Expected templates in ${templatesDir}, found none: nothing to check.`);
    process.exit(1);
  }

  const { found, files } = findCommands(templatesDir);
  for (const { file, line, text, command, npm } of found) {
    console.error(
      `TEMPLATE COMMAND NOT WRITTEN FOR NPM: ${file}:${line}\n` +
        `  ${text}\n` +
        `  \`${command}\` does not exist on a machine with only Node.js and npm; write \`${npm}\`.`,
    );
  }
  if (found.length > 0) {
    console.error(
      `\n${found.length} command(s) above. Template commands are written for npm ` +
        "(pnpm, yarn and bun users know the equivalent). A line that is about pnpm on " +
        "purpose goes in ALLOWED in scripts/check-template-commands.mjs, with the reason.",
    );
    process.exit(1);
  }

  console.log(
    `ok no pnpm, yarn or bun commands in ${files} files across ${templates.length} templates`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
