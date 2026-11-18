// A tripwire for `globalPassThroughEnv` in the root turbo.json, and the place
// that explains why that list exists.
//
// Turborepo runs every task in strict env mode: a variable that turbo.json
// does not declare is not passed to the task at all. Without the list,
// `AVAKIT_TELEMETRY_DISABLED=1 pnpm test` looks safe and is not. Turbo drops
// the variable, so a test or script that runs the scaffolder inside a task
// reports to the production collector anyway, and a caller's
// AVAKIT_CONFIG_DIR is ignored in favour of the real ~/.config/avakit. (CI is
// passed through by default, which is why CI runs were never affected.)
//
// The variables are passed through rather than hashed (`globalEnv`): they
// change side effects, not what a task produces.
//
// turbo.json is matched as text, not parsed, so this keeps working if the
// file ever gains comments, which Turborepo allows.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const turbo = readFileSync(join(root, "turbo.json"), "utf8");

test("turbo passes a caller's telemetry controls through to every task", () => {
  const list = turbo.match(/"globalPassThroughEnv":\s*\[([^\]]*)\]/)?.[1];
  assert.ok(list !== undefined, "turbo.json must declare globalPassThroughEnv");

  const passedThrough = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  for (const name of [
    "AVAKIT_TELEMETRY_DISABLED",
    "DO_NOT_TRACK",
    "AVAKIT_TELEMETRY_URL",
    "AVAKIT_CONFIG_DIR",
  ]) {
    assert.ok(
      passedThrough.includes(name),
      `${name} must stay in globalPassThroughEnv, or turbo drops it before the task runs`,
    );
  }
});
