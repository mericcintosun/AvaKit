import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: [
    "react",
    "react-dom",
    "@avakit/core",
    "viem",
    "@radix-ui/react-dialog",
    "class-variance-authority",
    "clsx",
    "lucide-react",
    "tailwind-merge",
  ],
});
