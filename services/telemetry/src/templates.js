/**
 * The templates `create-avalanche-app` ships — the only values `template` may
 * take. It is the one reported field that becomes a visible label on
 * avakit.dev/stats, so it is an exact list rather than a pattern: a pattern
 * let anyone put a label of their choosing on a public page with one request.
 *
 * Anything else is still counted, under "other". So when a template ships, add
 * its id here and deploy the collector, or its scaffolds are filed as "other"
 * until you do. test/templates.test.mjs fails as soon as this list and
 * packages/create-avalanche-app/templates/ disagree.
 */
export const TEMPLATES = [
  "minimal",
  "nft-mint",
  "token-gated-app",
  "erc20-token",
  "icm-messenger",
  "eerc-token",
  "l1-launch",
  "token-bridge",
];
