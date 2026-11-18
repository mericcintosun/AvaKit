// A tripwire for the telemetry controls in turbo.json.
//
// Turborepo runs tasks in strict env mode, so a variable that turbo.json does
// not declare never reaches the task. If the telemetry controls go missing
// from `globalPassThroughEnv`, `AVAKIT_TELEMETRY_DISABLED=1 pnpm test` still
// looks safe, but turbo strips the variable and anything that runs the
// scaffolder inside a task reports to the production collector again.
//
// turbo.json has comments, so it is matched as text rather than parsed.

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
