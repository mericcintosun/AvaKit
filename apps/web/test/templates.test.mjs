// The facts the website shows about each template (where it runs, whether it
// takes mainnet, whether it has a contract, whether it is experimental) are
// written in lib/content.ts by hand. They must say what the scaffolder's own
// manifests say, in every language. Run with `pnpm --filter @avakit/web test`
// (plain `node --test`, no build needed).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { getContent } from "../lib/content.ts";

const templatesDir = new URL("../../../packages/create-avalanche-app/templates/", import.meta.url);

/** id -> manifest, for every template the scaffolder ships. */
function manifests() {
  return Object.fromEntries(
    readdirSync(templatesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => existsSync(new URL(`${entry.name}/manifest.json`, templatesDir)))
      .map((entry) => [
        entry.name,
        JSON.parse(readFileSync(new URL(`${entry.name}/manifest.json`, templatesDir), "utf8")),
      ]),
  );
}

for (const locale of ["en", "tr"]) {
  test(`every template is listed once, with what its manifest says (${locale})`, () => {
    const shipped = manifests();
    const listed = getContent(locale).templates;
    assert.deepEqual(listed.map((t) => t.id).sort(), Object.keys(shipped).sort());

    for (const template of listed) {
      const manifest = shipped[template.id];
      assert.deepEqual(
        {
          contracts: template.contracts,
          runsOn: template.runsOn,
          mainnet: template.mainnet,
          experimental: template.experimental,
        },
        {
          contracts: manifest.contracts === true,
          runsOn: manifest.setup ? "devnet" : "fuji",
          mainnet: Array.isArray(manifest.chains) && manifest.chains.includes("c-chain"),
          // The scaffolder reads anything but a missing or "stable" status as experimental.
          experimental: manifest.status !== undefined && manifest.status !== "stable",
        },
        template.id,
      );
    }
  });
}

test("the experimental badge has a label in every language", () => {
  for (const locale of ["en", "tr"]) {
    const label = getContent(locale).templatesPage.experimental;
    assert.equal(typeof label, "string", locale);
    assert.ok(label.trim().length > 0, locale);
  }
});
