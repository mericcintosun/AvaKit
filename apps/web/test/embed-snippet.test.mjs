// The /avatar embed snippet must work when pasted on another site.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { embedSnippet, MODEL_VIEWER_SCRIPT, MODEL_VIEWER_VERSION } from "../lib/embed-snippet.ts";

const web = new URL("../", import.meta.url);
const fox = { src: "/3d/fox.glb", poster: "/3d/fox-hero.png", clip: "FoxIdle", title: "AvaFox" };

test("model and poster URLs are absolute on the given origin", () => {
  for (const origin of ["https://avakit.dev", "https://avakit.dev/"]) {
    const s = embedSnippet(fox, origin);
    assert.match(s, /src="https:\/\/avakit\.dev\/3d\/fox\.glb"/);
    assert.match(s, /poster="https:\/\/avakit\.dev\/3d\/fox-hero\.png"/);
    // No attribute left relative, which would resolve against the host page.
    assert.doesNotMatch(s, /(src|poster)="\//);
  }
});

test("the snippet loads the <model-viewer> module it depends on, at a pinned version", () => {
  const s = embedSnippet(fox, "https://avakit.dev");
  assert.ok(s.startsWith(`<script type="module" src="${MODEL_VIEWER_SCRIPT}"></script>\n`));
  assert.match(
    MODEL_VIEWER_SCRIPT,
    /@google\/model-viewer@\d+\.\d+\.\d+\/dist\/model-viewer\.min\.js$/,
  );
  assert.match(s, /<model-viewer\n[\s\S]*<\/model-viewer>$/);
});

test("the pinned version is the one the page itself loads", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", web), "utf8"));
  assert.equal(pkg.dependencies["@google/model-viewer"], MODEL_VIEWER_VERSION);
});

test("the page builds the snippet from the site's canonical origin", () => {
  const page = readFileSync(new URL("app/[locale]/avatar/page.tsx", web), "utf8");
  assert.match(page, /embedSnippet\(a, SITE_URL\)/);
});

test("the models are served with CORS so another origin can fetch them", () => {
  // next.config.ts pulls in Next.js plugins, so read its header rule as text.
  const config = readFileSync(new URL("next.config.ts", web), "utf8");
  const at = config.indexOf('source: "/3d/:path*"');
  assert.notEqual(at, -1, "no header rule for /3d/*");
  assert.match(
    config.slice(at, at + 200),
    /\{ key: "Access-Control-Allow-Origin", value: "\*" \}/,
    "the /3d/* rule must allow any origin",
  );
});
