// Fail when a pending changeset releases a package that is bundled into
// another one, and nothing releases the package that contains it.
//
// @avakit/mcp is published as one file with @avakit/core inside it (see
// packages/mcp/tsup.config.ts), so core is a devDependency of the server, not
// a dependency. Changesets only bumps the dependents of a released package
// through `dependencies` and `peerDependencies`: a fix to core is therefore
// released as a new @avakit/core and nothing else, while the server people
// install keeps shipping the old core until someone remembers to release it.
// This is what remembers.
//
// Usage: node scripts/check-changesets.mjs [changeset-dir]

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CHANGESET_DIR = resolve(here, "..", ".changeset");

/**
 * `[bundled, into]`: a release of the first must come with a release of the
 * second. scripts/check-changesets.test.mjs holds this list to what
 * packages/mcp/package.json says.
 */
export const BUNDLED_INTO = [["@avakit/core", "@avakit/mcp"]];

const BUMPS = ["major", "minor", "patch", "none"];

/**
 * The releases one changeset file asks for: `{ package: bump }`, from the
 * front matter: the lines between a `---` on its first line and the next one.
 */
export function parseChangeset(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1) {
    throw new Error("does not start with front matter (a block between two --- lines)");
  }
  const releases = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "") continue;
    const entry = line.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^\s:"']+))\s*:\s*(\S+)\s*$/);
    const bump = entry?.[4];
    if (!entry || !BUMPS.includes(bump)) {
      throw new Error(`has a front matter line that is not \`"package": bump\`: ${line.trim()}`);
    }
    releases[entry[1] ?? entry[2] ?? entry[3]] = bump;
  }
  return releases;
}

/** The pending changesets in `dir`: `[{ file, releases }]`, by file name. */
export function readChangesets(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name.toLowerCase() !== "readme.md")
    .sort()
    .map((name) => {
      try {
        return { file: name, releases: parseChangeset(readFileSync(join(dir, name), "utf8")) };
      } catch (error) {
        throw new Error(`${name} ${error.message}`);
      }
    });
}

/**
 * The bundled packages that would be released without the package that
 * contains them: `[{ bundled, into, files }]`, `files` being the changesets
 * that bump the bundled package. A bump of `none` releases nothing.
 */
export function findUnreleasedBundles(changesets, pairs = BUNDLED_INTO) {
  const bumping = (name) =>
    changesets.filter(({ releases }) => releases[name] && releases[name] !== "none");
  return pairs
    .map(([bundled, into]) => ({ bundled, into, files: bumping(bundled), also: bumping(into) }))
    .filter(({ files, also }) => files.length > 0 && also.length === 0)
    .map(({ bundled, into, files }) => ({
      bundled,
      into,
      files: files.map(({ file, releases }) => ({ file, bump: releases[bundled] })),
    }));
}

function main() {
  const dir = resolve(process.argv[2] ?? DEFAULT_CHANGESET_DIR);
  const shown = relative(process.cwd(), dir) || ".";

  // No pending changesets is the state right after a release, and passes. No
  // directory is what a moved or renamed .changeset looks like, and must not.
  if (!existsSync(dir)) {
    console.error(`CHANGESET DIRECTORY NOT FOUND: ${dir}`);
    process.exit(1);
  }

  let changesets;
  try {
    changesets = readChangesets(dir);
  } catch (error) {
    console.error(`CHANGESET UNREADABLE: ${shown}/${error.message}`);
    process.exit(1);
  }

  const missing = findUnreleasedBundles(changesets);
  for (const { bundled, into, files } of missing) {
    console.error(
      `CHANGESET MISSING: ${into}\n` +
        `  ${bundled} is bundled into the published ${into}, so releasing ${bundled} without\n` +
        `  ${into} leaves the old ${bundled} in the ${into} people install.\n` +
        `  These changesets release ${bundled}:\n` +
        files.map(({ file, bump }) => `    ${join(shown, file)} (${bump})`).join("\n") +
        `\n  and none of the ${changesets.length} pending changesets releases ${into}.\n` +
        `  Add one (pnpm changeset, select ${into}, patch) that says what the change in\n` +
        `  ${bundled} means for ${into}.`,
    );
  }
  if (missing.length > 0) process.exit(1);

  const pairs = BUNDLED_INTO.map(([bundled, into]) => `${bundled} with ${into}`).join(", ");
  console.log(
    `ok ${changesets.length} pending changesets: every bundled package is released together ` +
      `with the package that contains it (${pairs})`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
