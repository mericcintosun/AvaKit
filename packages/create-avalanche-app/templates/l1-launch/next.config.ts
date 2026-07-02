import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin this app as the Turbopack root so Next doesn't infer a parent workspace
  // from an outer lockfile (silences the "inferred workspace root" warning).
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
