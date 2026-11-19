import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Template files are stored with dot-prefixes stripped so they ship cleanly in
 * an npm package (npm refuses to publish a literal `.gitignore`, etc.). On
 * scaffold we restore the leading dot per path segment.
 */
const RENAME_SEGMENT: Record<string, string> = {
  gitignore: ".gitignore",
  "env.example": ".env.example",
  cursor: ".cursor",
  // npm leaves every .npmrc out of a published package, whatever `files` says.
  npmrc: ".npmrc",
};

/** Template-only files that must NOT be copied into the generated project. */
const TEMPLATE_ONLY = new Set(["manifest.json"]);

/**
 * What tools leave behind when they are run inside a template directory: an
 * install, a Next.js build, Turborepo. Never part of a template, at any depth.
 */
const BUILD_OUTPUT = new Set(["node_modules", ".next", ".turbo"]);

/**
 * What `forge build` and `forge script --broadcast` leave behind. Skipped only
 * directly under a `contracts` directory: anywhere else `out`, `cache` and
 * `broadcast` are ordinary names (an `/out` route, a `lib/cache` module).
 */
const FOUNDRY_OUTPUT = new Set(["out", "cache", "broadcast"]);

/**
 * Whether an entry in a template directory is something a tool or a developer
 * left there, rather than part of the template.
 *
 * A scaffold from a working checkout copied them all: megabytes of compiler
 * output, and a local `.env`, which can hold a key. Templates ship their
 * example as `env.example`, so a dotted env file is never one of ours.
 *
 * The published package is kept free of the same things by the negated entries
 * of `files` in package.json, which pack.test.ts holds to this list. Nothing
 * else did it: a publish from a working tree packed them, because `files` wins
 * over a root `.npmignore`, and only a clean checkout in CI happened to have
 * none. Change the two lists together.
 */
function isLeftBehind(name: string, inContracts: boolean): boolean {
  if (BUILD_OUTPUT.has(name)) return true;
  if (inContracts && FOUNDRY_OUTPUT.has(name)) return true;
  return name === ".env" || (name.startsWith(".env.") && name !== ".env.example");
}

export interface ScaffoldOptions {
  templateDir: string;
  targetDir: string;
  /** Literal placeholder → value, applied to every text file's contents. */
  replacements: Record<string, string>;
}

/**
 * Every file under `dir`, except what tools leave behind (see `isLeftBehind`).
 *
 * @param inContracts Whether `dir` is itself a directory named `contracts`.
 *   False for the template's root, whatever the template is called.
 */
async function walk(dir: string, inContracts = false): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => !isLeftBehind(entry.name, inContracts))
      .map((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory()
          ? walk(full, entry.name === "contracts")
          : Promise.resolve([full]);
      }),
  );
  return files.flat();
}

/** Copy a template into targetDir, renaming dot-files and replacing placeholders. */
export async function scaffold({
  templateDir,
  targetDir,
  replacements,
}: ScaffoldOptions): Promise<string[]> {
  const files = await walk(templateDir);
  const written: string[] = [];

  for (const abs of files) {
    const rel = path.relative(templateDir, abs);
    if (TEMPLATE_ONLY.has(rel)) {
      continue;
    }
    const outRel = rel
      .split(path.sep)
      .map((segment) => RENAME_SEGMENT[segment] ?? segment)
      .join(path.sep);
    const outPath = path.join(targetDir, outRel);

    // Defense in depth: never let a renamed/joined path escape targetDir, even
    // if a template ever carried a `..` segment. Mirrors studio's safeFile().
    const root = path.resolve(targetDir);
    const resolved = path.resolve(outPath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`Refusing to write outside the project directory: ${outRel}`);
    }

    await mkdir(path.dirname(outPath), { recursive: true });

    let content = await readFile(abs, "utf8");
    for (const [token, value] of Object.entries(replacements)) {
      content = content.split(token).join(value);
    }
    await writeFile(outPath, content);
    written.push(outRel);
  }

  return written;
}
