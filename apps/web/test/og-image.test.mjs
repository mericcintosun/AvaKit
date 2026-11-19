// The social card: its alt text must be the card's text word for word, and the
// card must not claim more than the code does. Run with `pnpm --filter
// @avakit/web test` (plain `node --test`, no build needed).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { OG_IMAGE } from "../lib/og-image.ts";

const web = new URL("../", import.meta.url);
const template = readFileSync(new URL("og/og-image.html", web), "utf8");
const png = readFileSync(new URL(`public${OG_IMAGE.url}`, web));

/** The words a reader sees, with markup, separators and spacing normalised away. */
function words(text) {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/—/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([.,])/g, "$1")
    .trim();
}

function cardText() {
  const body = template.slice(template.indexOf("<body>"), template.indexOf("</body>"));
  return words(body);
}

test("the alt text is the card's text, word for word", () => {
  assert.equal(words(OG_IMAGE.alt), cardText());
});

test("the card makes no claim the scaffolder cannot keep", () => {
  for (const text of [OG_IMAGE.alt, cardText()]) {
    // `npm create avalanche-app` installs dependencies and takes minutes.
    assert.doesNotMatch(text, /no install/i);
    assert.doesNotMatch(text, /60 seconds/i);
    assert.doesNotMatch(text, /no gas/i);
  }
});

test("the image on disk has the size the metadata declares", () => {
  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
  assert.equal(png.readUInt32BE(16), OG_IMAGE.width);
  assert.equal(png.readUInt32BE(20), OG_IMAGE.height);
});
