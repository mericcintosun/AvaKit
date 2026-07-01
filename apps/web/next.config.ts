import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root so Next doesn't pick up an unrelated lockfile elsewhere.
  turbopack: {
    root: path.join(dirname, "..", ".."),
  },
};

export default nextConfig;
