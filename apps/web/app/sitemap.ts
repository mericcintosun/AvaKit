import type { MetadataRoute } from "next";
import { site } from "@/lib/content";

const ROUTES = ["", "/templates", "/docs", "/docs/core", "/docs/react", "/docs/cli", "/docs/mcp"];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map((route) => ({
    url: `${site.url}${route}`,
    lastModified,
    changeFrequency: "weekly",
    priority: route === "" ? 1 : 0.7,
  }));
}
