import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  BUNDLED_INTO,
  findUnreleasedBundles,
  parseChangeset,
  readChangesets,
} from "./check-changesets.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "check-changesets.mjs");

/** A changeset file's text: front matter for `releases`, then a summary. */
const changeset = (releases, summary = "Something changed.") =>
  `---\n${Object.entries(releases)
    .map(([name, bump]) => `"${name}": ${bump}`)
    .join("\n")}\n---\n\n${summary}\n`;

/** A throwaway .changeset directory: `{ file name: contents }`. */
function changesetDir(t, files) {
  const dir = mkdtempSync(join(tmpdir(), "avakit-changesets-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);
  return dir;
}

const run = (dir) =>
  spawnSync(process.execPath, [script, ...(dir ? [dir] : [])], { encoding: "utf8" });

test("a core release with no server release fails and names the changesets", (t) => {
  const dir = changesetDir(t, {
    "brave-core-fix.md": changeset({ "@avakit/core": "patch" }),
    "calm-react-feature.md": changeset({ "@avakit/react": "minor", "@avakit/core": "minor" }),
    "quiet-cli-fix.md": changeset({ "create-avalanche-app": "patch" }),
  });

  assert.deepEqual(findUnreleasedBundles(readChangesets(dir)), [
    {
      bundled: "@avakit/core",
      into: "@avakit/mcp",
      files: [
        { file: "brave-core-fix.md", bump: "patch" },
        { file: "calm-react-feature.md", bump: "minor" },
      ],
    },
  ]);

  const result = run(dir);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^CHANGESET MISSING: @avakit\/mcp$/m);
  assert.match(result.stderr, /brave-core-fix\.md \(patch\)/);
  assert.match(result.stderr, /calm-react-feature\.md \(minor\)/);
  assert.doesNotMatch(result.stderr, /quiet-cli-fix\.md/);
  assert.match(result.stderr, /none of the 3 pending changesets releases @avakit\/mcp/);
});

test("a core release together with a server release passes", (t) => {
  const dir = changesetDir(t, {
    "brave-core-fix.md": changeset({ "@avakit/core": "patch" }),
    "kind-mcp-fix.md": changeset({ "@avakit/mcp": "patch" }),
  });

  assert.deepEqual(findUnreleasedBundles(readChangesets(dir)), []);
  const result = run(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^ok 2 pending changesets: .*@avakit\/core with @avakit\/mcp/);
});

test("both in one changeset passes", (t) => {
  const dir = changesetDir(t, {
    "both.md": changeset({ "@avakit/core": "patch", "@avakit/mcp": "patch" }),
  });
  assert.equal(run(dir).status, 0);
});

test("changesets that do not touch core pass, and so does having none", (t) => {
  const some = changesetDir(t, {
    "kind-mcp-fix.md": changeset({ "@avakit/mcp": "minor" }),
    "quiet-cli-fix.md": changeset({ "create-avalanche-app": "patch" }),
  });
  assert.equal(run(some).status, 0);

  // Right after a release every changeset has been consumed.
  const none = changesetDir(t, { "config.json": "{}", "README.md": "# Changesets\n" });
  assert.deepEqual(readChangesets(none), []);
  const result = run(none);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^ok 0 pending changesets/);
});

test("a changeset directory that does not exist fails instead of passing as empty", (t) => {
  const missing = join(changesetDir(t, {}), "moved-away");
  const result = run(missing);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^CHANGESET DIRECTORY NOT FOUND: .*moved-away$/m);
});

test("a bump of none releases nothing, on either side", (t) => {
  // Core is not released, so the server need not be.
  const coreNone = changesetDir(t, { "a.md": changeset({ "@avakit/core": "none" }) });
  assert.equal(run(coreNone).status, 0);

  // Core is released and the server is explicitly not: that is the gap.
  const mcpNone = changesetDir(t, {
    "a.md": changeset({ "@avakit/core": "patch" }),
    "b.md": changeset({ "@avakit/mcp": "none" }),
  });
  const result = run(mcpNone);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /a\.md \(patch\)/);
});

test("front matter is read as Changesets writes it and as people edit it", () => {
  assert.deepEqual(
    parseChangeset('---\n"@avakit/core": patch\n"@avakit/mcp": minor\n---\n\nText.'),
    {
      "@avakit/core": "patch",
      "@avakit/mcp": "minor",
    },
  );
  assert.deepEqual(
    parseChangeset("---\r\n'@avakit/core': major\r\ncreate-avalanche-app:   patch\r\n---\r\n"),
    { "@avakit/core": "major", "create-avalanche-app": "patch" },
  );
  // An empty changeset (`changeset --empty`) releases nothing.
  assert.deepEqual(parseChangeset("---\n---\n\nNothing to release.\n"), {});
  // A rule further down the summary is not front matter.
  assert.deepEqual(
    parseChangeset('---\n"@avakit/mcp": patch\n---\n\nA\n\n---\n\n"@avakit/core": patch\n'),
    {
      "@avakit/mcp": "patch",
    },
  );
});

test("a changeset that cannot be read fails, naming the file, instead of passing", (t) => {
  assert.throws(
    () => parseChangeset("No front matter here.\n"),
    /does not start with front matter/,
  );
  // Changesets reads front matter from the top of the file only, so a block
  // further down releases nothing and must not be taken for one.
  assert.throws(
    () => parseChangeset('A summary.\n\n---\n"@avakit/mcp": patch\n---\n'),
    /does not start with front matter/,
  );
  assert.throws(() => parseChangeset('---\n"@avakit/mcp": patch\n'), /does not start with/);
  assert.throws(
    () => parseChangeset('---\n"@avakit/core": pathc\n---\n'),
    /not `"package": bump`: "@avakit\/core": pathc/,
  );

  const dir = changesetDir(t, {
    "broken.md": '---\n"@avakit/core" patch\n---\n\nA colon went missing.\n',
  });
  const result = run(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^CHANGESET UNREADABLE: .*broken\.md has a front matter line/);
});

test("the rule matches how the server is built and published", () => {
  // If core ever becomes a runtime dependency of the server again, Changesets
  // bumps the server by itself and this pair should go.
  assert.deepEqual(BUNDLED_INTO, [["@avakit/core", "@avakit/mcp"]]);
  const root = join(here, "..");
  const mcp = JSON.parse(readFileSync(join(root, "packages", "mcp", "package.json"), "utf8"));
  assert.equal(mcp.name, "@avakit/mcp");
  assert.equal(mcp.devDependencies["@avakit/core"], "workspace:*");
  assert.equal(mcp.dependencies["@avakit/core"], undefined);
  assert.match(
    readFileSync(join(root, "packages", "mcp", "tsup.config.ts"), "utf8"),
    /noExternal: \[[^\]]*"@avakit\/core"/,
  );
});

test("the changesets pending in this repository pass", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^ok \d+ pending changesets/);
});
