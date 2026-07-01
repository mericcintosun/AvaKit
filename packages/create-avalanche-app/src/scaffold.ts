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
};

/** Template-only files that must NOT be copied into the generated project. */
const TEMPLATE_ONLY = new Set(["manifest.json"]);

export interface ScaffoldOptions {
  templateDir: string;
  targetDir: string;
  /** Literal placeholder → value, applied to every text file's contents. */
  replacements: Record<string, string>;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : Promise.resolve([full]);
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
