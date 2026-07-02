import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/content";

// Landing + templates are translated (EN at /, TR at /tr). Docs are English-only
// and canonicalize to their EN path, so they're listed once.
const TRANSLATED = ["", "/templates"];
const EN_ONLY = ["/docs", "/docs/core", "/docs/react", "/docs/cli", "/docs/mcp"];

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
      },
    },
  }));
  const enOnly = EN_ONLY.map((route) => ({
    url: `${SITE_URL}${route}`,
    lastModified,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));
  return [...translated, ...enOnly];
}
