// A tripwire for what keeps the library tests honest. `pnpm test` in each of
// the four libraries measures coverage and fails under the thresholds in the
// package's vitest.config.ts, and none of them passes when it finds no tests
// (it used to: `vitest run --passWithNoTests` let a suite that lost all its
// files stay green). The coverage provider has to be the same version as
// Vitest itself, which loads it.
//
// Files are read as text, not executed: the repo has no YAML dependency, and a
// config that no longer matches these patterns deserves a look either way.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8").replace(/\r\n/g, "\n");
const LIBRARIES = ["core", "react", "mcp", "create-avalanche-app"];

test("each library's test script measures coverage and fails when it finds no tests", () => {
  for (const dir of LIBRARIES) {
    const script = JSON.parse(read("packages", dir, "package.json")).scripts.test;
    assert.match(script, /^vitest run\b/, `packages/${dir}: ${script}`);
    assert.match(script, /(^|\s)--coverage(\s|$)/, `packages/${dir} measures coverage`);
    assert.doesNotMatch(script, /passWithNoTests/, `packages/${dir} fails with no tests`);
  }
});

test("each library's vitest.config.ts sets all four coverage thresholds", () => {
  for (const dir of LIBRARIES) {
    const config = read("packages", dir, "vitest.config.ts");
    assert.match(config, /provider: "v8"/, `packages/${dir}/vitest.config.ts`);
    const thresholds = config.match(/thresholds: \{([^}]*)/)?.[1];
    assert.ok(thresholds, `packages/${dir}/vitest.config.ts has thresholds`);
    for (const metric of ["statements", "branches", "functions", "lines"]) {
      const value = Number(thresholds.match(new RegExp(`\\b${metric}: (\\d+(?:\\.\\d+)?)`))?.[1]);
      assert.ok(value > 0 && value <= 100, `packages/${dir}: ${metric} threshold (${value})`);
    }
  }
});

test("@vitest/coverage-v8 is pinned to the Vitest version in the catalog", () => {
  const vitest = read("pnpm-workspace.yaml").match(/^ {2}"?vitest"?: *"?([^"\s]+)"?$/m)?.[1];
  const provider = JSON.parse(read("package.json")).devDependencies["@vitest/coverage-v8"];
  assert.ok(vitest, "pnpm-workspace.yaml has a vitest entry in its catalog");
  assert.equal(provider, vitest);
});
