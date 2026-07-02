import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AvaKit — AI-native Avalanche devtools",
    short_name: "AvaKit",
    description:
      "Avalanche's open-source, AI-native create-next-app: scaffold a social-login dapp, deploy-ready, with agent context baked in.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0c",
    theme_color: "#0b0b0c",
    icons: [
      { src: "/icon.png", sizes: "any", type: "image/png" },
      { src: "/logo.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
