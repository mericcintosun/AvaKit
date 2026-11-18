import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AvaKit — AI-native Avalanche devtools",
    short_name: "AvaKit",
    description:
      "An open-source, AI-native create-next-app for Avalanche: scaffold a working dapp with a temporary test wallet, social login and browser wallets, and agent context baked in.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0c",
    theme_color: "#0b0b0c",
    // Square PNGs rendered from the logo at exactly the declared size (see
    // app/pwa and lib/pwa-icon.tsx). The logo file itself is 582 × 653, and a
    // browser drops an icon whose real size differs from the one declared here,
    // which leaves a standalone app with no usable icon.
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/pwa/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
