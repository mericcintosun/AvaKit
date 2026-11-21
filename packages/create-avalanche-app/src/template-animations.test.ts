import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listTemplates, templatesDir } from "./api.js";
import { templateFiles } from "./scaffold.js";

/**
 * The animation rule (docs/11-conventions.md §3) in the templates: Framer Motion
 * or GSAP, and `tw-animate-css` only for the enter and exit animations of
 * shadcn/ui primitives. The templates have no shadcn primitive of their own;
 * the one they show is the connect dialog of @avakit/react, a shadcn Dialog,
 * and that is what their `@import "tw-animate-css"` is for. So no template
 * file may start a CSS animation itself: no `animate-*` utility (Tailwind's
 * own `animate-spin`, `animate-ping` and `animate-pulse` included), none of
 * tw-animate-css's `fade-in`, `zoom-in` or `slide-in-from-*` classes, and no
 * `@keyframes` or `animation:` of its own. A transition between two states (a
 * hover colour) is not an animation in this sense and is not looked for.
 */

/** What only a keyframe animation needs, as a class or as CSS. */
const ANIMATION =
  /(?<![\w-])(?:animate-|fade-(?:in|out)\b|zoom-(?:in|out)\b|spin-(?:in|out)\b|slide-(?:in-from|out-to)-)|@keyframes\b|(?<![\w-])animation(?:-name)?\s*:/;

const SOURCE = /\.(?:[cm]?[jt]sx?|css)$/;

/**
 * Every line that starts an animation in the source files an app gets from the
 * template in `dir`, as `file:line: text` with `file` relative to `root`. The
 * files are the scaffolder's own list, so build output is skipped exactly where
 * a scaffold skips it: `node_modules`, `.next` and `.turbo` anywhere, Foundry's
 * `out`, `cache` and `broadcast` only directly under a `contracts` directory.
 */
async function animations(dir: string, root: string): Promise<string[]> {
  const found: string[] = [];
  for (const file of await templateFiles(dir)) {
    if (!SOURCE.test(file)) continue;
    const name = path.relative(root, file).split(path.sep).join("/");
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (ANIMATION.test(line)) found.push(`${name}:${index + 1}: ${line.trim()}`);
      });
  }
  return found;
}

describe("animations in the templates", () => {
  it("start no CSS animation of their own", async () => {
    const found: string[] = [];
    for (const template of listTemplates()) {
      found.push(...(await animations(path.join(templatesDir, template.id), templatesDir)));
    }
    expect(found).toEqual([]);
  });

  it("recognises what it is looking for", () => {
    // The pattern itself, so a typo in it cannot pass the test above unnoticed.
    for (const line of [
      '<span className="size-2 animate-ping rounded-full" />',
      "className={live ? 'bg-foreground animate-pulse' : 'bg-muted'}",
      '<Loader2 className="animate-spin" />',
      '"data-[state=open]:animate-in data-[state=open]:fade-in-0 zoom-in-95"',
      "slide-in-from-top-2",
      "@keyframes blink {",
      "  animation: blink 1s infinite;",
    ]) {
      expect(ANIMATION.test(line), line).toBe(true);
    }
    for (const line of [
      '@import "tw-animate-css";',
      '"tw-animate-css": "1.4.0",',
      '<div className="transition-colors hover:bg-muted" />',
      "const reanimated = fadeInterval;",
    ]) {
      expect(ANIMATION.test(line), line).toBe(false);
    }
  });

  it("reads every file a scaffold copies, and skips only what a scaffold leaves out", async () => {
    // The files themselves, so an `/out` route or a `lib/cache` module, which
    // are part of the app, cannot slip past the test above.
    const dir = mkdtempSync(path.join(tmpdir(), "caa-animations-"));
    try {
      const line = '<span className="size-2 animate-ping rounded-full" />';
      const copied = [
        "app/out/page.tsx",
        "app/broadcast/page.tsx",
        "lib/cache/index.ts",
        "contracts/script/broadcast/notes.ts",
      ];
      const leftOut = [
        "contracts/out/leftover.js",
        "contracts/cache/leftover.ts",
        "contracts/broadcast/leftover.ts",
        "node_modules/pkg/index.js",
        "app/node_modules/pkg/index.js",
        ".next/static/chunk.js",
        "lib/.turbo/leftover.ts",
      ];
      for (const file of [...copied, ...leftOut]) {
        const full = path.join(dir, ...file.split("/"));
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, `${line}\n`);
      }
      expect((await animations(dir, dir)).sort()).toEqual(
        copied.map((file) => `${file}:1: ${line}`).sort(),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keep tw-animate-css for the shadcn Dialog in @avakit/react", () => {
    for (const template of listTemplates()) {
      const dir = path.join(templatesDir, template.id);
      const css = readFileSync(path.join(dir, "app", "globals.css"), "utf8");
      expect(css, template.id).toContain('@import "tw-animate-css";');
      // The classes it provides come from the dialog, which the app's Tailwind
      // build reaches through this line.
      expect(css, template.id).toContain('@source "../node_modules/@avakit/react/dist";');
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
        devDependencies?: Record<string, string>;
      };
      expect(pkg.devDependencies?.["tw-animate-css"], template.id).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
