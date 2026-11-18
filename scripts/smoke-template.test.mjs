// What scripts/smoke-template.sh must never get wrong, checked without the
// network and without the real scaffolder.
//
// The script is copied into a fake repo whose "CLI" is a stub: it writes down
// the environment and directory it was started with, then fails, which ends
// the script right after its scaffold step. No app is installed or built, and
// nothing here can send a telemetry event.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "smoke-template.sh");
// A bash script: on Windows it only runs under WSL or Git Bash.
const skip = process.platform === "win32";

const STUB_CLI = `
const { writeFileSync } = require("node:fs");
writeFileSync(
  process.env.SMOKE_TEST_RECORD,
  JSON.stringify({
    cwd: process.cwd(),
    args: process.argv.slice(2),
    telemetryDisabled: process.env.AVAKIT_TELEMETRY_DISABLED ?? null,
  }),
);
process.exit(7);
`;

/**
 * Run a copy of the script in a fake repo and return how it exited and what
 * its stub CLI saw.
 *
 * The script is given a work directory inside the fake repo unless
 * `ownWorkdir` is set, in which case it creates a temporary one itself. `env`
 * is merged over the caller's environment; `undefined` removes a variable.
 */
function smoke(t, { ownWorkdir = false, env = {} } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "avakit-smoke-test-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  mkdirSync(join(repo, "scripts"));
  cpSync(script, join(repo, "scripts", "smoke-template.sh"));
  for (const dir of ["create-avalanche-app", "core", "react"]) {
    mkdirSync(join(repo, "packages", dir, "dist"), { recursive: true });
  }
  // The stub is CommonJS wherever the temporary directory happens to live.
  writeFileSync(join(repo, "package.json"), JSON.stringify({ type: "commonjs" }));
  writeFileSync(join(repo, "packages", "create-avalanche-app", "dist", "index.js"), STUB_CLI);

  const record = join(repo, "record.json");
  const workdir = ownWorkdir ? null : join(repo, "work");
  const childEnv = {
    ...process.env,
    SMOKE_TEST_RECORD: record,
    // Belt and braces: the stub sends nothing, but should this test ever be
    // pointed at the real CLI, its events must have nowhere to go.
    AVAKIT_TELEMETRY_URL: "http://127.0.0.1:9/e",
    ...env,
  };
  for (const [name, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[name];
  }

  const result = spawnSync(
    "bash",
    [join(repo, "scripts", "smoke-template.sh"), "minimal", ...(workdir ? [workdir] : [])],
    { env: childEnv, encoding: "utf8" },
  );
  assert.ok(existsSync(record), `the stub CLI never ran:\n${result.stdout}${result.stderr}`);
  return { ...result, workdir, seen: JSON.parse(readFileSync(record, "utf8")) };
}

test("the scaffolder runs with telemetry off when the caller left it on", { skip }, (t) => {
  const { status, seen } = smoke(t, {
    env: { AVAKIT_TELEMETRY_DISABLED: undefined, DO_NOT_TRACK: undefined },
  });

  assert.equal(seen.telemetryDisabled, "1");
  assert.deepEqual(seen.args, ["smoke-minimal", "--template", "minimal", "--yes", "--no-install"]);
  assert.equal(status, 7, "the script passes the CLI's failure on");
});

test("a caller cannot switch telemetry back on", { skip }, (t) => {
  const { seen } = smoke(t, { env: { AVAKIT_TELEMETRY_DISABLED: "0" } });

  assert.equal(seen.telemetryDisabled, "1");
});

test("the temporary directory it creates is removed, even when the run fails", { skip }, (t) => {
  const { status, seen, stderr } = smoke(t, { ownWorkdir: true, env: { SMOKE_KEEP: undefined } });
  // So that a failing run of this test does not leak the directory it reports.
  t.after(() => rmSync(seen.cwd, { recursive: true, force: true }));

  assert.equal(status, 7);
  assert.equal(existsSync(seen.cwd), false, `${seen.cwd} was left behind`);
  assert.match(stderr, /SMOKE_KEEP=1/);
});

test("SMOKE_KEEP=1 keeps the temporary directory and prints where it is", { skip }, (t) => {
  const { seen, stdout } = smoke(t, { ownWorkdir: true, env: { SMOKE_KEEP: "1" } });
  t.after(() => rmSync(seen.cwd, { recursive: true, force: true }));

  assert.equal(existsSync(seen.cwd), true);
  assert.match(stdout, /kept .*SMOKE_KEEP=1/);
});

test("a directory passed by the caller is never removed", { skip }, (t) => {
  const { seen, workdir } = smoke(t, { env: { SMOKE_KEEP: undefined } });

  assert.equal(seen.cwd, realpathSync(workdir));
  assert.equal(existsSync(workdir), true);
});
