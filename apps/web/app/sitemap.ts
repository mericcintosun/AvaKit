import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/content";

// Landing + templates are translated (EN at /, TR at /tr). Everything else is
// English-only and canonicalizes to its EN path (see pageMetadata), so it is
// listed once. Keep both lists in step with the pages' own metadata; /pitch is
// left out on purpose, it is a deck to hand out, not a page to be found.
const TRANSLATED = ["", "/templates"];
const EN_ONLY = [
  "/new",
  "/docs",
  "/docs/core",
  "/docs/react",
  "/docs/cli",
  "/docs/mcp",
  "/docs/studio",
  "/docs/telemetry",
  "/stats",
  "/terminal",
  "/avatar",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const translated = TRANSLATED.map((route) => ({
    url: `${SITE_URL}${route}`,
    lastModified,
    changeFrequency: "weekly" as const,
    priority: route === "" ? 1 : 0.7,
    alternates: {
      languages: {
        en: `${SITE_URL}${route}`,
        tr: `${SITE_URL}/tr${route}`,
        "x-default": `${SITE_URL}${route}`,
      },
    },
  }));
  const enOnly = EN_ONLY.map((route) => ({
    url: `${SITE_URL}${route}`,
    lastModified,
    changeFrequency: "weekly" as const,
    // /new is the "Try it now" page the header leads to.
    priority: route === "/new" ? 0.9 : 0.6,
  }));
  return [...translated, ...enOnly];
}
