import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findCommands } from "./check-template-commands.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "check-template-commands.mjs");
const realTemplates = join(here, "..", "packages", "create-avalanche-app", "templates");

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "avakit-template-commands-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A throwaway templates directory with one template, "app", whose package.json
 * has a `devnet` script: `{ "relative/path": contents }`.
 */
function templatesDir(t, files) {
  const dir = tempDir(t);
  const app = join(dir, "app");
  mkdirSync(app);
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({ scripts: { dev: "next dev", devnet: "bash scripts/devnet.sh" } }),
  );
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(app, path)), { recursive: true });
    writeFileSync(join(app, path), contents);
  }
  return dir;
}

const run = (dir) => spawnSync(process.execPath, [script, dir], { encoding: "utf8" });

test("the templates in the repository pass, and a pnpm line added to a copy of them fails", (t) => {
  const dir = tempDir(t);
  cpSync(realTemplates, dir, {
    recursive: true,
    filter: (src) => !/[\\/](node_modules|\.next)$/.test(src),
  });

  const clean = run(dir);
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /^ok no pnpm, yarn or bun commands in \d+ files across 8 templates/);

  appendFileSync(join(dir, "icm-messenger", "README.md"), "\nThen run pnpm devnet again.\n");
  const dirty = run(dir);
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /TEMPLATE COMMAND NOT WRITTEN FOR NPM: icm-messenger\/README\.md:\d+/);
  assert.match(dirty.stderr, /`pnpm devnet` .* write `npm run devnet`/);
});

test("each form of a pnpm, yarn or bun command is caught, with its file, line and npm form", (t) => {
  const dir = templatesDir(t, {
    "README.md": [
      "# app", // 1
      "pnpm dev    # http://localhost:3000", // 2
      "Run `pnpm run devnet` first.", // 3
      "pnpm install", // 4
      "yarn dev", // 5
      "bun run dev", // 6
      "CLEAN=1 pnpm devnet", // 7
      "Then re-run pnpm devnet.", // 8
      "bun install", // 9
    ].join("\n"),
    "components/demo.tsx": 'export const C = () => <CopyCommand command="yarn devnet" />;\n',
    "scripts/devnet.sh": 'die "Then re-run: pnpm devnet"\n',
  });

  const { found } = findCommands(dir);
  assert.deepEqual(
    found.map(({ file, line, command, npm }) => [file, line, command, npm]),
    [
      ["app/README.md", 2, "pnpm dev", "npm run dev"],
      ["app/README.md", 3, "pnpm run devnet", "npm run devnet"],
      ["app/README.md", 4, "pnpm install", "npm install"],
      ["app/README.md", 5, "yarn dev", "npm run dev"],
      ["app/README.md", 6, "bun run dev", "npm run dev"],
      ["app/README.md", 7, "pnpm devnet", "npm run devnet"],
      ["app/README.md", 8, "pnpm devnet", "npm run devnet"],
      ["app/README.md", 9, "bun install", "npm install"],
      ["app/components/demo.tsx", 1, "yarn devnet", "npm run devnet"],
      ["app/scripts/devnet.sh", 1, "pnpm devnet", "npm run devnet"],
    ],
  );

  const result = run(dir);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /TEMPLATE COMMAND NOT WRITTEN FOR NPM: app\/README\.md:2\n {2}pnpm dev/,
  );
  assert.match(result.stderr, /TEMPLATE COMMAND NOT WRITTEN FOR NPM: app\/scripts\/devnet\.sh:1/);
  assert.match(result.stderr, /10 command\(s\) above/);
});

test("npm commands and prose that only names the tools pass", (t) => {
  const dir = templatesDir(t, {
    "README.md": [
      "The commands are written for npm; pnpm, yarn and bun work as well.",
      "npm install",
      "npm run dev",
      "CLEAN=1 npm run devnet",
      "pnpm-workspace.yaml pre-approves native builds; ERR_PNPM_IGNORED_BUILDS on pnpm 10+.",
      "a bun is not a command, and neither is pnpm settings",
    ].join("\n"),
  });

  assert.deepEqual(findCommands(dir).found, []);
  const result = run(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^ok no pnpm, yarn or bun commands in 2 files across 1 templates/);
});

test("a script name is a command only in the template that has the script", (t) => {
  const dir = templatesDir(t, { "README.md": "pnpm bridge\n" });
  assert.deepEqual(findCommands(dir).found, []);

  writeFileSync(
    join(dir, "app", "package.json"),
    JSON.stringify({ scripts: { bridge: "bash scripts/bridge.sh" } }),
  );
  assert.deepEqual(
    findCommands(dir).found.map(({ command }) => command),
    ["pnpm bridge"],
  );
});

test("the pnpm-workspace.yaml comments are allowed, nothing else is", (t) => {
  const explanation =
    "# allowBuilds: pre-approve native postinstall scripts so `pnpm install` / `pnpm dev`\n";
  const dir = templatesDir(t, {
    "pnpm-workspace.yaml": `${explanation}allowBuilds:\n  sharp: true\n`,
    "CLAUDE.md": explanation,
  });

  // The same sentence passes as a pnpm-workspace.yaml comment and fails anywhere else.
  assert.deepEqual(
    findCommands(dir).found.map(({ file, command }) => [file, command]),
    [
      ["app/CLAUDE.md", "pnpm install"],
      ["app/CLAUDE.md", "pnpm dev"],
    ],
  );

  // And only its comments: a command outside a comment there is still reported.
  writeFileSync(join(dir, "app", "CLAUDE.md"), "");
  appendFileSync(join(dir, "app", "pnpm-workspace.yaml"), "run: pnpm install\n");
  const result = run(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /app\/pnpm-workspace\.yaml:4\n {2}run: pnpm install/);
});

test("binary files and node_modules are not read", (t) => {
  const dir = templatesDir(t, {
    "public/icon.png": Buffer.from([0x89, 0x50, 0x00, ...Buffer.from(" pnpm dev ")]),
    "node_modules/x/README.md": "pnpm dev\n",
  });

  assert.deepEqual(findCommands(dir).found, []);
});

test("finding no templates is an error, not a pass", (t) => {
  const result = run(tempDir(t));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /found none: nothing to check/);
});
