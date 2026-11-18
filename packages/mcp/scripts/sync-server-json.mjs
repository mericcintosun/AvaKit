#!/usr/bin/env node
/**
 * Keep server.json — the MCP Registry listing — on the version in package.json.
 *
 * Changesets bumps package.json and knows nothing about server.json, so the
 * listing once sat two releases behind and kept pointing registry clients at a
 * build that predated a round of security hardening. Run this after every
 * version bump (ideally as part of the repo's version script) and commit the
 * result; `src/registry.test.ts` fails while the two disagree.
 *
 *   node scripts/sync-server-json.mjs           rewrite server.json if it is behind
 *   node scripts/sync-server-json.mjs --check   change nothing; exit 1 if it is behind
 */

import { readFileSync, writeFileSync } from "node:fs";

const check = process.argv.includes("--check");
const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

const pkg = read("package.json");
const listing = read("server.json");

const stale = [];
if (listing.version !== pkg.version) stale.push(`version ${listing.version}`);
listing.version = pkg.version;
for (const entry of listing.packages ?? []) {
  if (entry.identifier !== pkg.name) continue;
  if (entry.version !== pkg.version) stale.push(`packages[${entry.identifier}] ${entry.version}`);
  entry.version = pkg.version;
}

if (stale.length === 0) {
  console.log(`server.json already lists ${pkg.name}@${pkg.version}.`);
} else if (check) {
  console.error(
    `server.json is behind package.json (${pkg.version}): ${stale.join(", ")}.\n` +
      "Run: pnpm --filter @avakit/mcp run sync:server-json",
  );
  process.exitCode = 1;
} else {
  writeFileSync(
    new URL("../server.json", import.meta.url),
    `${JSON.stringify(listing, null, 2)}\n`,
  );
  console.log(`server.json updated to ${pkg.name}@${pkg.version} (was: ${stale.join(", ")}).`);
}
