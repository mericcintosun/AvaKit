/**
 * The social card every page points at. The image is rendered from
 * og/og-image.html (see the comment there for how), and `alt` is the card's
 * text word for word, in reading order: test/og-image.test.mjs fails when the
 * two drift apart, or when the card claims what the code does not do.
 *
 * This module imports nothing, so that test can load it with plain Node.
 */
export const OG_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "Open source · MIT — Avalanche’s open-source, AI-native create-next-app. A real Fuji transaction in about a minute, in your browser. One command, or one prompt, to a working Avalanche dapp. $ npm create avalanche-app — avakit.dev",
};
