// Fail when two create-avalanche-app templates pin different versions of a
// dependency they share.
//
// The templates are standalone apps, not workspace members, so the root
// lockfile says nothing about them, and Dependabot is not pointed at them
// either: their package.json files carry placeholders the scaffolder fills in
// (`"@avakit/core": "__AVAKIT_CORE_DEP__"`) where it expects version ranges
// (see .github/dependabot.yml). Their dependencies are therefore bumped by
// hand, and this is what keeps a bump from landing in some templates and not
// in the others — every app `npm create avalanche-app` produces should be on
// the same Next.js, React and viem.
//
// A dependency only one template uses (eerc-token's wagmi, for instance) has
// nothing to agree with and is ignored.
//
// Usage: node scripts/check-template-deps.mjs [templates-dir]

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATES_DIR = resolve(here, "..", "packages", "create-avalanche-app", "templates");

const SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** The templates in `templatesDir`: its sub-directories that have a package.json. */
export function listTemplates(templatesDir) {
  return readdirSync(templatesDir)
    .filter((name) => existsSync(join(templatesDir, name, "package.json")))
    .sort();
}

/** dependency name -> version -> the templates that pin that version. */
export function collectVersions(templatesDir) {
  const versions = new Map();
  for (const template of listTemplates(templatesDir)) {
    const pkg = JSON.parse(readFileSync(join(templatesDir, template, "package.json"), "utf8"));
    for (const section of SECTIONS) {
      for (const [name, version] of Object.entries(pkg[section] ?? {})) {
        if (!versions.has(name)) versions.set(name, new Map());
        const byVersion = versions.get(name);
        if (!byVersion.has(version)) byVersion.set(version, new Set());
        byVersion.get(version).add(template);
      }
    }
  }
  return versions;
}

/** The dependencies pinned to more than one version: `[{ name, versions }]`. */
export function findDrift(templatesDir) {
  return [...collectVersions(templatesDir)]
    .filter(([, byVersion]) => byVersion.size > 1)
    .map(([name, byVersion]) => ({ name, versions: byVersion }));
}

function main() {
  const templatesDir = resolve(process.argv[2] ?? DEFAULT_TEMPLATES_DIR);

  // A check that finds nothing to compare must not pass: that is what a moved
  // or renamed templates directory would look like.
  const templates = listTemplates(templatesDir);
  if (templates.length < 2) {
    console.error(
      `Expected at least two templates in ${templatesDir}, found ${templates.length}: ` +
        "nothing to compare.",
    );
    process.exit(1);
  }

  const drift = findDrift(templatesDir);
  for (const { name, versions } of drift) {
    const width = Math.max(...[...versions.keys()].map((version) => version.length));
    console.error(
      `TEMPLATE DEPENDENCY DRIFT: ${name}\n` +
        [...versions]
          .map(([version, pinnedBy]) => `  ${version.padEnd(width)}  ${[...pinnedBy].join(", ")}`)
          .join("\n") +
        "\n  Templates must pin the same version of a dependency they share:" +
        "\n  bump it in every template's package.json in the same commit.",
    );
  }
  if (drift.length > 0) process.exit(1);

  // No drift, so every dependency has exactly one version here.
  const shared = [...collectVersions(templatesDir).values()].filter(
    (byVersion) => [...byVersion.values()][0].size > 1,
  ).length;
  console.log(
    `ok ${shared} shared dependencies are pinned identically across ${templates.length} templates`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
