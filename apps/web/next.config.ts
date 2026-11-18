import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next.js 16.4 guesses the route of a link it has not prefetched from the
  // routes it already knows. English pages are served without a prefix by a
  // rewrite ("/stats" is really "/en/stats"), so the guess takes the footer's
  // "/stats" and "/avatar" for "/[locale]": the home page then asks them for a
  // segment they do not have (a 404 in the console) and refetches them in a loop.
  experimental: { optimisticRouting: false },
  // Pin the workspace root so Next doesn't pick up an unrelated lockfile elsewhere.
  turbopack: {
    root: path.join(dirname, "..", ".."),
  },
  images: {
    // Next.js only serves the qualities listed here and quietly falls back to
    // the nearest one, so the template line art's `quality={95}` was being
    // delivered at 75.
    qualities: [75, 95],
  },
  // Baseline response headers for every route. Deliberately no
  // Content-Security-Policy yet: the theme script and the JSON-LD block are
  // inline, so a CSP needs nonces and its own rollout.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Never guess a script or stylesheet type from its bytes.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Other origins learn where a visitor came from, not which page.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // /new signs transactions with one click, so no other site may frame it.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // The site uses none of these.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
