// A tripwire for the one property of .github/workflows/release.yml that must
// not be lost quietly: nothing is versioned or published before lint,
// typecheck, the tests, the changeset check and the MCP install smoke test
// have passed in the same job.
//
// The file is read as text, not parsed — the repo has no YAML dependency, and
// the release job is a flat list of named steps. If you restructure the
// workflow, keep the guarantee and update this test with it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Line endings are normalised so a checkout with CRLF reads the same.
const release = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8").replace(
  /\r\n/g,
  "\n",
);

/** The workflow's steps in order, each as the text from its `- name:` line to the next one. */
const steps = release.split(/^(?= +- name:)/m).slice(1);

/** Position of the only step with a line matching `pattern`. */
function stepWith(pattern) {
  const found = steps.flatMap((step, index) => (pattern.test(step) ? [index] : []));
  assert.equal(found.length, 1, `expected exactly one step matching ${pattern} in release.yml`);
  return found[0];
}

test("release.yml runs lint, typecheck, the tests and the package checks before changesets/action", () => {
  const publish = stepWith(/^ +uses: changesets\/action@/m);

  for (const command of [
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    // A core release must take the MCP server (which bundles core) with it.
    "node scripts/check-changesets.mjs",
    // The packed MCP server has to install and start, not only pass its tests.
    'bash scripts/smoke-mcp.sh "\\$RUNNER_TEMP/smoke-mcp"',
  ]) {
    const gate = stepWith(new RegExp(`^ +run: ${command}$`, "m"));
    assert.ok(gate < publish, `\`${command}\` must run before the changesets/action step`);
    // A step that may fail or be skipped does not stop a red tree.
    assert.doesNotMatch(
      steps[gate],
      /^ +(continue-on-error|if):/m,
      `the \`${command}\` step must not be optional`,
    );
  }
});
