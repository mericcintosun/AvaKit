import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listTemplates, templatesDir } from "./api.js";

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
const SKIP = new Set(["node_modules", ".next", ".turbo", "out", "cache", "broadcast"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return SOURCE.test(entry.name) ? [full] : [];
  });
}

describe("animations in the templates", () => {
  it("start no CSS animation of their own", () => {
    const found: string[] = [];
    for (const template of listTemplates()) {
      for (const file of sourceFiles(path.join(templatesDir, template.id))) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, index) => {
            if (ANIMATION.test(line)) {
              found.push(`${path.relative(templatesDir, file)}:${index + 1}: ${line.trim()}`);
            }
          });
      }
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

  it("keep tw-animate-css for the shadcn Dialog in @avakit/react, and only there", () => {
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
