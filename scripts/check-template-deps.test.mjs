import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findDrift } from "./check-template-deps.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-template-deps.mjs");

/** A throwaway templates directory: `{ template: package.json contents }`. */
function templatesDir(t, templates) {
  const dir = mkdtempSync(join(tmpdir(), "avakit-template-deps-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, pkg] of Object.entries(templates)) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "package.json"), JSON.stringify(pkg));
  }
  return dir;
}

const run = (dir) => spawnSync(process.execPath, [script, dir], { encoding: "utf8" });

test("templates that pin the same versions pass", (t) => {
  const pkg = {
    dependencies: { "@avakit/core": "__AVAKIT_CORE_DEP__", next: "16.2.9" },
    devDependencies: { typescript: "6.0.3" },
  };
  const dir = templatesDir(t, { minimal: pkg, "nft-mint": pkg });

  assert.deepEqual(findDrift(dir), []);
  const result = run(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^ok 3 shared dependencies .* across 2 templates/);
});

test("a dependency pinned to two versions fails and names the templates", (t) => {
  const dir = templatesDir(t, {
    minimal: { dependencies: { next: "16.2.9", react: "19.2.7" } },
    "nft-mint": { dependencies: { next: "16.2.10", react: "19.2.7" } },
    "erc20-token": { dependencies: { next: "16.2.9", react: "19.2.7" } },
  });

  const drift = findDrift(dir);
  assert.deepEqual(
    drift.map(({ name }) => name),
    ["next"],
  );
  assert.deepEqual([...drift[0].versions.get("16.2.9")], ["erc20-token", "minimal"]);
  assert.deepEqual([...drift[0].versions.get("16.2.10")], ["nft-mint"]);

  const result = run(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TEMPLATE DEPENDENCY DRIFT: next/);
  assert.match(result.stderr, /16\.2\.10 +nft-mint/);
});

test("the same dependency is compared across dependencies and devDependencies", (t) => {
  const dir = templatesDir(t, {
    minimal: { dependencies: { viem: "2.54.1" } },
    "nft-mint": { devDependencies: { viem: "2.54.0" } },
  });

  assert.deepEqual(
    findDrift(dir).map(({ name }) => name),
    ["viem"],
  );
});

test("a dependency only one template uses is not a mismatch", (t) => {
  const dir = templatesDir(t, {
    minimal: { dependencies: { next: "16.2.9" } },
    "eerc-token": { dependencies: { next: "16.2.9", wagmi: "2.19.5" } },
  });

  assert.deepEqual(findDrift(dir), []);
  assert.equal(run(dir).status, 0);
});

test("finding fewer than two templates is an error, not a pass", (t) => {
  const dir = templatesDir(t, { minimal: { dependencies: { next: "16.2.9" } } });

  const result = run(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Expected at least two templates/);
});
