import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { TEMPLATES } from "../src/templates.js";

/** Where create-avalanche-app keeps the templates it ships, one directory each. */
const SHIPPED = fileURLToPath(
  new URL("../../../packages/create-avalanche-app/templates/", import.meta.url),
);

describe("TEMPLATES", () => {
  it("lists exactly the templates create-avalanche-app ships", (t) => {
    if (!existsSync(SHIPPED)) {
      t.skip("not inside the AvaKit monorepo");
      return;
    }
    const shipped = readdirSync(SHIPPED, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    // A template missing here is not lost, but every scaffold of it is filed
    // under "other" on avakit.dev/stats until the collector is redeployed.
    assert.deepEqual([...TEMPLATES].sort(), shipped.sort());
  });

  it("holds plain slugs, since they are spliced into a pattern", () => {
    for (const id of TEMPLATES) assert.match(id, /^[a-z0-9][a-z0-9-]*$/);
    assert.equal(new Set(TEMPLATES).size, TEMPLATES.length);
    assert.ok(!TEMPLATES.includes("other"), '"other" is the bucket for everything else');
  });
});
