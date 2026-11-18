/**
 * What the build checks about `dist/index.js`, and the licence notices it
 * writes next to it.
 *
 * The published server is one file that contains its third-party code (the MCP
 * SDK, viem, zod and what they pull in), so that a first `npx -y @avakit/mcp`
 * downloads one small dependency tree instead of 150 packages. Two things
 * follow from that, and both are settled here from the bundler's metafile,
 * which lists every file that went into the output:
 *
 *   • Shipping other people's code means shipping their licence notices:
 *     `dist/THIRD_PARTY_LICENSES.txt` names every bundled package with its
 *     version, licence and licence text. A package whose licence is missing or
 *     not on the allow-list below fails the build.
 *   • The bundle must stay self-contained and small. A bare import that was
 *     left for run time, a `require` inside bundled CommonJS, or a transport
 *     the stdio server never uses would each bring the slow, or broken, first
 *     start back. Each fails the build, naming the package.
 *
 * `tsup.config.ts` runs this as an esbuild plugin; `src/bundle-audit.test.ts`
 * covers it. No dependencies: Node built-ins only.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";

/** The name of the notices file, written into the build's output directory. */
export const NOTICES_FILE = "THIRD_PARTY_LICENSES.txt";

/** Permissive licences whose terms are met by shipping their text, which is what the notices file does. */
export const ALLOWED_LICENSES = [
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "Unlicense",
  "CC0-1.0",
];

/**
 * The only packages the bundle may leave to be resolved at run time, i.e. the
 * `dependencies` of the published package. `create-avalanche-app` finds its
 * templates next to its own files, so it cannot be bundled.
 */
export const RUNTIME_DEPENDENCIES = ["create-avalanche-app"];

/**
 * Packages that only serve transports this stdio server never opens: viem's
 * WebSocket transport and the SDK's HTTP server transports. They must be
 * tree-shaken away, never bundled.
 */
export const NEVER_BUNDLED = ["ws", "isows", "express", "cors", "hono", "@hono/node-server"];

const LICENSE_FILE = /^(licen[sc]e|copying|notice)([.-].*)?$/i;
const RULE = "=".repeat(80);
const THIN_RULE = "-".repeat(80);

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** The directory of the package a bundled file belongs to. */
function packageDirOf(file) {
  const marker = "/node_modules/";
  const at = file.lastIndexOf(marker);
  if (at !== -1) {
    const [first = "", second = ""] = file.slice(at + marker.length).split("/");
    return path.join(
      file.slice(0, at + marker.length),
      first.startsWith("@") ? `${first}/${second}` : first,
    );
  }
  // A workspace package is linked, not installed: the bundler reports its real
  // path. Its root is the nearest directory whose package.json has a name — a
  // bare `{ "type": "module" }` in a build folder is not one.
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (existsSync(manifest) && typeof readJson(manifest).name === "string") return dir;
    if (dir === path.dirname(dir)) return undefined;
  }
}

/** The licence a package.json declares, as an SPDX expression; `undefined` when it declares none. */
function declaredLicense(manifest) {
  const one = (entry) => (typeof entry === "string" ? entry : entry?.type);
  const declared = Array.isArray(manifest.licenses)
    ? manifest.licenses.map(one).join(" AND ")
    : one(manifest.license);
  return typeof declared === "string" && declared.trim() !== "" ? declared.trim() : undefined;
}

/**
 * Whether an SPDX expression can be met from the allow-list: one identifier,
 * or identifiers joined by OR (any one will do) and AND (all are needed).
 * Anything else — an exception clause, a nested expression — is refused rather
 * than guessed at.
 */
export function licenseAllowed(expression) {
  // npm writes a compound expression in one pair of brackets: "(MIT OR ISC)".
  const flat = expression.trim().replace(/^\(([^()]*)\)$/, "$1");
  return flat
    .split(/\s+OR\s+/)
    .some((choice) =>
      choice.split(/\s+AND\s+/).every((id) => ALLOWED_LICENSES.includes(id.trim())),
    );
}

/**
 * Every package with code in the bundle, from the metafile: name, version,
 * licence, licence text, and how many bytes of the output are its code.
 * Files of the package being built are not third-party and are left out.
 *
 * @param {{ outputs: Record<string, { entryPoint?: string, inputs: Record<string, { bytesInOutput: number }> }> }} metafile
 * @param {{ cwd: string, self: string }} options the directory the metafile's paths are relative to, and the name of the package being built
 */
export function bundledPackages(metafile, { cwd, self }) {
  const byDir = new Map();
  for (const output of Object.values(metafile.outputs)) {
    for (const [file, { bytesInOutput }] of Object.entries(output.inputs)) {
      // Listed, but tree-shaken down to nothing: none of it is shipped.
      if (bytesInOutput === 0) continue;
      const dir = packageDirOf(path.resolve(cwd, file));
      if (!dir) throw new Error(`Cannot tell which package the bundled file ${file} belongs to.`);
      byDir.set(dir, (byDir.get(dir) ?? 0) + bytesInOutput);
    }
  }
  const packages = [];
  for (const [dir, bytes] of byDir) {
    const manifest = readJson(path.join(dir, "package.json"));
    if (manifest.name === self) continue;
    const files = readdirSync(dir)
      .filter((name) => LICENSE_FILE.test(name))
      .sort();
    packages.push({
      name: String(manifest.name),
      version: String(manifest.version),
      license: declaredLicense(manifest),
      licenseText: files
        .map((name) => readFileSync(path.join(dir, name), "utf8").replace(/\r\n/g, "\n").trim())
        .join("\n\n"),
      bytes,
    });
  }
  return packages.sort(
    (a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"),
  );
}

/** What is wrong with the licences of the bundled packages, one sentence per problem. */
export function licenseProblems(packages) {
  const problems = [];
  for (const { name, version, license, licenseText } of packages) {
    const id = `${name}@${version}`;
    if (!license && !licenseText) {
      problems.push(
        `${id} is bundled but has neither a licence file nor a "license" field in its package.json.`,
      );
    } else if (!license) {
      problems.push(
        `${id} is bundled and ships a licence file, but its package.json declares no "license", so it cannot be checked against the allow-list (${ALLOWED_LICENSES.join(", ")}).`,
      );
    } else if (!licenseAllowed(license)) {
      problems.push(
        `${id} is bundled and licensed "${license}", which is not on the allow-list (${ALLOWED_LICENSES.join(", ")}).`,
      );
    }
  }
  return problems;
}

/** What would stop the bundle from starting on its own, or make it large again. */
export function bundleProblems(metafile, packages) {
  const problems = [];
  const seen = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const { path: specifier, kind, external } of output.imports ?? []) {
      if (!external || seen.has(`${kind} ${specifier}`)) continue;
      seen.add(`${kind} ${specifier}`);
      const builtin = isBuiltin(specifier);
      if (kind === "require-call") {
        // In an ES module there is no `require`: the call throws when reached.
        problems.push(
          `The bundle calls require("${specifier}") from bundled CommonJS, which fails in an ES module. ` +
            (builtin
              ? "Give the bundle a `require` (createRequire(import.meta.url) in the banner) before shipping this."
              : "Bundle that package or remove what pulls it in."),
        );
      } else if (
        !builtin &&
        !RUNTIME_DEPENDENCIES.some((name) => specifier === name || specifier.startsWith(`${name}/`))
      ) {
        problems.push(
          `The bundle imports "${specifier}" at run time, but the published package only depends on ${RUNTIME_DEPENDENCIES.join(", ")}: bundle it (noExternal in tsup.config.ts).`,
        );
      }
    }
  }
  for (const { name } of packages) {
    if (NEVER_BUNDLED.includes(name)) {
      problems.push(
        `${name} is in the bundle. It belongs to a transport the stdio server never uses; find the import that pulls it in instead of shipping it.`,
      );
    }
  }
  return problems;
}

/** The text of the notices file. The same bundle always gives the same text. */
export function renderNotices(packages, self) {
  const lines = [
    `Software bundled into ${self}`,
    "",
    `The published ${self} is a single file, dist/index.js, that contains the code of the`,
    "packages listed here together with the server itself. Each is used under its own",
    "licence, reproduced below. This file is written by the build from the list of files",
    "the bundler put into dist/index.js; do not edit it by hand.",
    "",
    `Bundled packages (${packages.length}):`,
    "",
    ...packages.map(({ name, version, license }) => `  ${name} ${version} (${license})`),
    "",
  ];
  for (const { name, version, license, licenseText } of packages) {
    lines.push(
      RULE,
      `${name} ${version}`,
      `License: ${license}`,
      THIN_RULE,
      "",
      licenseText ||
        `This package ships no licence file. Its package.json declares the licence as ${license}.`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Check a finished build and render its notices.
 *
 * @returns {{ packages: ReturnType<typeof bundledPackages>, problems: string[], notices: string }}
 */
export function auditBundle(metafile, { cwd, self }) {
  const packages = bundledPackages(metafile, { cwd, self });
  return {
    packages,
    problems: [...licenseProblems(packages), ...bundleProblems(metafile, packages)],
    notices: renderNotices(packages, self),
  };
}

/**
 * The esbuild plugin `tsup.config.ts` installs: after every build, fail it on
 * a problem, and otherwise write the notices file into the output directory.
 *
 * @param {{ self: string }} options the name of the package being built
 */
export function bundleAuditPlugin({ self }) {
  return {
    name: "avakit-bundle-audit",
    setup(build) {
      // What everything above is read from.
      build.initialOptions.metafile = true;
      build.onEnd((result) => {
        if (result.errors.length > 0 || !result.metafile) return;
        const cwd = build.initialOptions.absWorkingDir ?? process.cwd();
        const { problems, notices } = auditBundle(result.metafile, { cwd, self });
        if (problems.length > 0) {
          return { errors: problems.map((text) => ({ pluginName: "avakit-bundle-audit", text })) };
        }
        const outDir = path.resolve(cwd, build.initialOptions.outdir ?? "dist");
        mkdirSync(outDir, { recursive: true });
        writeFileSync(path.join(outDir, NOTICES_FILE), notices);
      });
    },
  };
}
