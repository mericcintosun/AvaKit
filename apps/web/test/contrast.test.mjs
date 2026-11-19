// WCAG AA from the design tokens in app/globals.css, in both themes, and the
// class patterns that took focus rings and small text below it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const web = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, web), "utf8");
const css = read("app/globals.css");

/** The `--name: oklch(L C h)` tokens declared directly in a `selector { … }` block. */
function tokens(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} block not found`);
  const block = css.slice(start, css.indexOf("\n}", start));
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

/** OKLCH to linear sRGB, clamped to the gamut. */
function linear([L, C, h]) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((x) => Math.min(1, Math.max(0, x)));
}

function contrast(x, y) {
  const lum = (c) => {
    const [r, g, b] = linear(c);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

const light = tokens(":root");
const themes = { light, dark: { ...light, ...tokens(".dark") } };

for (const [name, t] of Object.entries(themes)) {
  test(`${name}: muted text reaches 4.5:1 on the page and on muted surfaces`, () => {
    // Inline <code>, the ⌘K hint and the /new and /avatar code chips are
    // muted-foreground on bg-muted.
    assert.ok(contrast(t["muted-foreground"], t.muted) >= 4.5);
    assert.ok(contrast(t["muted-foreground"], t.background) >= 4.5);
    assert.ok(contrast(t["muted-foreground"], t.card) >= 4.5);
  });

  test(`${name}: the full-opacity focus ring reaches 3:1 on the page`, () => {
    // The ring sits on a ring-offset band in the page colour, so the page is
    // what it is seen against, whatever the component's own fill.
    assert.ok(contrast(t.ring, t.background) >= 3);
  });
}

test("every focus ring in components/ui is full opacity with a page-coloured offset", () => {
  const dir = new URL("components/ui/", web);
  let rings = 0;
  for (const file of readdirSync(dir)) {
    const src = readFileSync(new URL(file, dir), "utf8");
    // ring-ring/50 measured 2.1–2.6:1 against the page and the button.
    assert.doesNotMatch(src, /ring-ring\/\d+/, `${file} uses a translucent ring`);
    for (const line of src.split("\n").filter((l) => l.includes("focus-visible:ring-"))) {
      rings++;
      assert.match(line, /focus-visible:ring-ring\b/, file);
      assert.match(line, /focus-visible:ring-offset-2\b/, file);
      assert.match(line, /focus-visible:ring-offset-background\b/, file);
    }
  }
  assert.ok(rings >= 3, "button, tabs and accordion all draw a focus ring");
});

test("pitch eyebrows and counters, and landing indices, are not faded below AA", () => {
  // On the pitch deck's dark surface, foreground at /50 is 5.1:1; /40 was 3.66
  // and /30 was 2.53. muted-foreground at /50 was 1.96:1 on white.
  for (const path of [
    "app/[locale]/pitch/page.tsx",
    "app/[locale]/new/live-demo.tsx",
    "components/landing/sections.tsx",
  ]) {
    for (const line of read(path).split("\n")) {
      if (line.includes("select-none")) continue; // decorative separators
      assert.doesNotMatch(line, /text-foreground\/[1-4]0\b/, `${path}: ${line.trim()}`);
      assert.doesNotMatch(line, /text-muted-foreground\/\d+/, `${path}: ${line.trim()}`);
    }
  }
});
