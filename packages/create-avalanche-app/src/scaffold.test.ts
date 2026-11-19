import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffold } from "./scaffold.js";

let dir: string;
let templateDir: string;
let targetDir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "caa-scaffold-"));
  templateDir = path.join(dir, "template");
  targetDir = path.join(dir, "app");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** `a/b/c` as a path on this platform. */
const native = (posix: string) => posix.split("/").join(path.sep);

/** Create a template from `files`: path (with `/`) → content. */
function template(files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(templateDir, native(file));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

/** Scaffold the template and return what was written, sorted, with `/` separators. */
async function scaffolded(replacements: Record<string, string> = {}): Promise<string[]> {
  const files = await scaffold({ templateDir, targetDir, replacements });
  return files.map((file) => file.split(path.sep).join("/")).sort();
}

describe("scaffold", () => {
  it("copies a template, restoring dot-files and filling in placeholders", async () => {
    template({
      "package.json": '{ "name": "__PROJECT_NAME__" }',
      "app/page.tsx": "export const chain = __CHAIN_CONST__;",
      gitignore: "node_modules/",
      "env.example": "NEXT_PUBLIC_EXAMPLE=",
      npmrc: "legacy-peer-deps=true",
      "cursor/rules/avakit.mdc": "rules for __PROJECT_NAME__",
      "manifest.json": '{ "title": "Fixture" }',
    });

    expect(await scaffolded({ __PROJECT_NAME__: "my-app", __CHAIN_CONST__: "fuji" })).toEqual([
      ".cursor/rules/avakit.mdc",
      ".env.example",
      ".gitignore",
      ".npmrc",
      "app/page.tsx",
      "package.json",
    ]);
    const read = (file: string) => readFileSync(path.join(targetDir, native(file)), "utf8");
    expect(read("package.json")).toBe('{ "name": "my-app" }');
    expect(read("app/page.tsx")).toBe("export const chain = fuji;");
    expect(read(".cursor/rules/avakit.mdc")).toBe("rules for my-app");
  });

  it("leaves out build output and installed dependencies found in a template", async () => {
    // What a template directory picks up when tools are run in it: `forge build`
    // and `forge script --broadcast`, an install, a Next.js or Turborepo build.
    // The npm tarball never has these; a scaffold from a checkout copied them all.
    template({
      "package.json": "{}",
      "app/page.tsx": "page",
      "contracts/foundry.toml": "[profile.default]",
      "contracts/src/Token.sol": "contract Token {}",
      "contracts/out/Token.sol/Token.json": "{}",
      "contracts/out/build-info/0123abcd.json": "{}",
      "contracts/cache/solidity-files-cache.json": "{}",
      "contracts/broadcast/Deploy.s.sol/43113/run-latest.json": "{}",
      "node_modules/react/index.js": "module.exports = {};",
      "node_modules/.bin/next": "#!/bin/sh",
      "contracts/node_modules/forge-std/package.json": "{}",
      ".next/BUILD_ID": "build",
      ".next/cache/webpack/client/0.pack": "pack",
      ".turbo/turbo-build.log": "log",
    });

    expect(await scaffolded()).toEqual([
      "app/page.tsx",
      "contracts/foundry.toml",
      "contracts/src/Token.sol",
      "package.json",
    ]);
    for (const leftover of [
      "contracts/out",
      "contracts/cache",
      "contracts/broadcast",
      "contracts/node_modules",
      "node_modules",
      ".next",
      ".turbo",
    ]) {
      expect(existsSync(path.join(targetDir, native(leftover))), leftover).toBe(false);
    }
  });

  it("keeps directories that only share a name with Foundry's output", async () => {
    // `out`, `cache` and `broadcast` are build output directly under contracts/
    // and nowhere else: an /out route or a lib/cache module is part of the app.
    const files = {
      "app/out/page.tsx": "page",
      "app/broadcast/page.tsx": "page",
      "lib/cache/index.ts": "export {};",
      "out/README.md": "kept",
      "contracts/src/cache/Cache.sol": "contract Cache {}",
      "contracts/script/broadcast/Notes.md": "kept",
    };
    template(files);
    expect(await scaffolded()).toEqual(Object.keys(files).sort());
  });

  it("leaves out local environment files, which can hold secrets", async () => {
    template({
      "package.json": "{}",
      "env.example": "NEXT_PUBLIC_EXAMPLE=",
      ".env": "LOCAL_ONLY=1",
      ".env.local": "LOCAL_ONLY=1",
      ".env.production.local": "LOCAL_ONLY=1",
      "contracts/.env": "LOCAL_ONLY=1",
      "contracts/foundry.toml": "[profile.default]",
    });

    expect(await scaffolded()).toEqual([".env.example", "contracts/foundry.toml", "package.json"]);
    expect(readFileSync(path.join(targetDir, ".env.example"), "utf8")).toBe("NEXT_PUBLIC_EXAMPLE=");
    expect(existsSync(path.join(targetDir, ".env"))).toBe(false);
    expect(existsSync(path.join(targetDir, ".env.local"))).toBe(false);
    expect(existsSync(path.join(targetDir, "contracts", ".env"))).toBe(false);
  });
});
