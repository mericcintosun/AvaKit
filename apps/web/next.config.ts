import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
};

export default withNextIntl(nextConfig);
