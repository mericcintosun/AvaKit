// The packages the release workflow publishes, and the one thing it does to
// them before anything is published: packing.
//
// .github/workflows/release.yml runs this in its verify job, after the gates
// (lint, typecheck, tests, the changeset check, the MCP install smoke test):
//
//   node scripts/release-packages.mjs state
//     Whether changesets are pending: `pending=true` means the run opens or
//     updates the version PR and publishes nothing, `pending=false` means the
//     run may publish. Changesets in pre mode is refused: the publish job
//     publishes to the `latest` dist-tag only.
//
//   node scripts/release-packages.mjs pack <dir> [--registry <url>]
//     Packs every publishable package of the workspace into <dir> with
//     `pnpm pack`. pnpm writes the real version over `workspace:` and
//     `catalog:` ranges there, as publishing does, and this fails when a
//     packed package.json still holds such a range, or names another package
//     or version than the source. It then asks the npm registry which
//     name@version it does not have yet, and writes <dir>/manifest.json (for
//     each tarball: name, version, file, sha256, integrity, and whether npm
//     already has that version) and <dir>/SHA256SUMS. The publish job checks
//     both before it publishes a byte.
//
// Both commands write `key=value` lines to $GITHUB_OUTPUT and a summary to
// $GITHUB_STEP_SUMMARY when those are set. Nothing here publishes: the npm
// registry is only read.
//
// scripts/release-tags.mjs reads the same package list (publishablePackages)
// to tag what was published.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { readChangesets } from "./check-changesets.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// This script is not a Turborepo task and nothing it does is cached, so what it
// reads from the environment has no entry in turbo.json.
const ENV = process.env;

export const REGISTRY = "https://registry.npmjs.org";

/** Where a consumer's package manager reads ranges from. */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "devDependencies",
];

/** The fields that order the publishes: what a consumer installs with the package. */
const RUNTIME_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

/** A range that only means something inside this workspace. */
const LOCAL_RANGE = /^(?:workspace|catalog|link|file):/;

/** A tarball name the publish job can pass to npm and to sha256sum as it is. */
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/;

/**
 * The `packages:` globs of a pnpm-workspace.yaml. Only `dir` and `dir/*`
 * entries are understood, which is all this repository uses: anything else
 * (`**`, a negation, braces) throws rather than being half-understood.
 */
export function workspaceGlobs(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^packages:\s*(?:#.*)?$/.test(line));
  if (start === -1) throw new Error("pnpm-workspace.yaml has no top-level `packages:` list");
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    // The next top-level key ends the list.
    if (!/^\s/.test(line)) break;
    const entry = line.match(/^\s+-\s+(?:"([^"]*)"|'([^']*)'|([^\s#"']+))\s*(?:#.*)?$/);
    if (!entry) throw new Error(`pnpm-workspace.yaml: cannot read the entry \`${line.trim()}\``);
    const glob = entry[1] ?? entry[2] ?? entry[3];
    if (!/^[\w.-]+(?:\/[\w.-]+)*(?:\/\*)?$/.test(glob)) {
      throw new Error(
        `pnpm-workspace.yaml: only \`dir\` and \`dir/*\` entries are supported here, not \`${glob}\``,
      );
    }
    globs.push(glob);
  }
  if (globs.length === 0) throw new Error("pnpm-workspace.yaml lists no packages");
  return globs;
}

/**
 * `packages` with every package after the packages of the list it depends on,
 * so that nothing is published before what it needs. Ties keep name order.
 */
export function dependencyOrder(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const state = new Map();
  const ordered = [];
  const visit = (pkg, path) => {
    if (state.get(pkg.name) === "done") return;
    if (state.get(pkg.name) === "visiting") {
      throw new Error(`workspace dependency cycle: ${[...path, pkg.name].join(" -> ")}`);
    }
    state.set(pkg.name, "visiting");
    for (const field of RUNTIME_FIELDS) {
      for (const name of Object.keys(pkg.manifest[field] ?? {}).sort()) {
        const dependency = byName.get(name);
        if (dependency && dependency !== pkg) visit(dependency, [...path, pkg.name]);
      }
    }
    state.set(pkg.name, "done");
    ordered.push(pkg);
  };
  for (const pkg of [...packages].sort((a, b) => (a.name < b.name ? -1 : 1))) visit(pkg, []);
  return ordered;
}

/**
 * Every workspace package that is not private, dependencies first:
 * `[{ name, version, dir, manifest }]`.
 */
export function publishablePackages(root = ROOT) {
  const globs = workspaceGlobs(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"));
  const dirs = globs.flatMap((glob) => {
    if (!glob.endsWith("/*")) return [join(root, glob)];
    const parent = join(root, glob.slice(0, -2));
    if (!existsSync(parent)) return [];
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parent, entry.name))
      .sort();
  });
  const packages = [];
  const seen = new Map();
  for (const dir of dirs) {
    const file = join(dir, "package.json");
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    if (manifest.private === true) continue;
    const shown = relative(root, file);
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      throw new Error(`${shown} is publishable but has no name or no version`);
    }
    if (seen.has(manifest.name)) {
      throw new Error(
        `${manifest.name} is the name of both ${seen.get(manifest.name)} and ${shown}`,
      );
    }
    seen.set(manifest.name, shown);
    packages.push({ name: manifest.name, version: manifest.version, dir, manifest });
  }
  return dependencyOrder(packages);
}

/**
 * The pending changeset files, `[]` right after a release. Pre mode throws: a
 * prerelease belongs on its own dist-tag, and the publish job publishes to
 * `latest` only.
 */
export function pendingChangesets(root = ROOT) {
  const dir = join(root, ".changeset");
  if (!existsSync(dir)) throw new Error(`${dir} not found`);
  const pre = join(dir, "pre.json");
  if (existsSync(pre) && JSON.parse(readFileSync(pre, "utf8")).mode === "pre") {
    throw new Error(
      "Changesets is in pre mode (.changeset/pre.json). release.yml publishes to the latest " +
        "dist-tag only, so it neither versions nor publishes in pre mode: run `pnpm changeset pre exit`.",
    );
  }
  return readChangesets(dir).map(({ file }) => file);
}

/** A NUL-terminated string field of a tar header. */
function tarField(header, start, length) {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString("utf8");
}

/** The `path` record of a pax extended header, if it has one. */
function paxPath(body) {
  let offset = 0;
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(body.subarray(offset, space).toString("utf8"), 10);
    if (!Number.isInteger(length) || length <= 0) break;
    const record = body.subarray(space + 1, offset + length - 1).toString("utf8");
    if (record.startsWith("path=")) return record.slice(5);
    offset += length;
  }
  return null;
}

/**
 * One file out of a .tgz, or null when the archive has no such file. Enough
 * of tar for what npm and pnpm write: ustar names with a prefix, pax `path`
 * records and GNU long names.
 */
export function readTarEntry(tgz, wanted) {
  const tar = gunzipSync(tgz);
  let offset = 0;
  let longName = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(tarField(header, 124, 12).trim() || "0", 8);
    if (!Number.isInteger(size) || size < 0) throw new Error("the archive has a malformed header");
    const type = tarField(header, 156, 1);
    const prefix = tarField(header, 257, 6).startsWith("ustar") ? tarField(header, 345, 155) : "";
    const name =
      longName ?? (prefix ? `${prefix}/${tarField(header, 0, 100)}` : tarField(header, 0, 100));
    longName = null;
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") longName = paxPath(body);
    else if (type === "L") longName = body.toString("utf8").replace(/\0+$/, "");
    else if ((type === "0" || type === "") && name === wanted) return Buffer.from(body);
  }
  return null;
}

/** A tarball's sha256 (hex), its npm integrity (sha512) and its package.json. */
export function inspectTarball(buffer) {
  const raw = readTarEntry(buffer, "package/package.json");
  if (raw === null) throw new Error("the tarball has no package/package.json");
  return {
    sha256: createHash("sha256").update(buffer).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(buffer).digest("base64")}`,
    manifest: JSON.parse(raw.toString("utf8")),
  };
}

/** What is wrong with the package.json packed for `pkg`: `[]` when nothing is. */
export function packedProblems(packed, pkg) {
  const problems = [];
  if (packed.name !== pkg.name) problems.push(`its name is ${packed.name}, not ${pkg.name}`);
  if (packed.version !== pkg.version) {
    problems.push(`its version is ${packed.version}, not ${pkg.version}`);
  }
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, range] of Object.entries(packed[field] ?? {})) {
      if (typeof range === "string" && LOCAL_RANGE.test(range)) {
        problems.push(`${field}["${name}"] is still "${range}", which no consumer can install`);
      }
    }
  }
  return problems;
}

/** The registry URL of one version of a package. */
export function versionUrl(name, version, registry = REGISTRY) {
  return `${registry.replace(/\/+$/, "")}/${name.replace("/", "%2F")}/${encodeURIComponent(version)}`;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Whether the registry has `name@version`: "published" or "unpublished".
 * Anything but a clear yes or no (after three tries for a network error or a
 * 5xx) throws, so that a registry outage never reads as "not published yet".
 */
export async function registryStatus(name, version, options = {}) {
  const { registry = REGISTRY, fetch = globalThis.fetch, attempts = 3, retryMs = 2000 } = options;
  const url = versionUrl(name, version, registry);
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${url}: ${error.message}`);
      await sleep(retryMs * attempt);
      continue;
    }
    if (response.status === 404) return "unpublished";
    if (response.status === 200) {
      const body = await response.json();
      if (body?.name !== name || body?.version !== version) {
        throw new Error(`${url} answered with ${body?.name}@${body?.version}`);
      }
      return "published";
    }
    if (response.status >= 500 && attempt < attempts) {
      await sleep(retryMs * attempt);
      continue;
    }
    throw new Error(`${url} answered HTTP ${response.status}`);
  }
}

/** `pnpm pack` of the package in `dir` into `outDir`; the tarball's path. */
export function pnpmPack(dir, outDir) {
  const result = spawnSync("pnpm", ["pack", "--pack-destination", outDir, "--json"], {
    cwd: dir,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`pnpm pack failed in ${dir}:\n${result.stderr || result.stdout}`);
  }
  let info;
  try {
    info = JSON.parse(result.stdout);
  } catch {
    throw new Error(`pnpm pack printed no JSON in ${dir}:\n${result.stdout}`);
  }
  const filename = Array.isArray(info) ? info[0]?.filename : info?.filename;
  if (typeof filename !== "string") throw new Error(`pnpm pack named no tarball in ${dir}`);
  return resolve(outDir, filename);
}

/**
 * Pack every publishable package into `outDir`, check each tarball, ask the
 * registry which versions it lacks, and write manifest.json and SHA256SUMS.
 */
export async function packAll(options) {
  const { root = ROOT, outDir, registry = REGISTRY, fetch, pack = pnpmPack } = options;
  mkdirSync(outDir, { recursive: true });
  const leftovers = readdirSync(outDir);
  if (leftovers.length > 0) {
    throw new Error(`${outDir} is not empty (${leftovers.join(", ")}): pack into a new directory`);
  }
  const packages = publishablePackages(root);
  if (packages.length === 0) throw new Error("the workspace has no publishable package");

  const entries = [];
  for (const pkg of packages) {
    const file = pack(pkg.dir, outDir);
    const shown = `${basename(file)} (${pkg.name} in ${relative(root, pkg.dir)})`;
    const inside = existsSync(file) && realpathSync(dirname(file)) === realpathSync(outDir);
    if (!inside || !SAFE_FILE.test(basename(file))) {
      throw new Error(`${shown}: the tarball must be a plain file name inside ${outDir}`);
    }
    const { sha256, integrity, manifest } = inspectTarball(readFileSync(file));
    const problems = packedProblems(manifest, pkg);
    if (problems.length > 0) throw new Error(`${shown}: ${problems.join("; ")}`);
    entries.push({ name: pkg.name, version: pkg.version, file: basename(file), sha256, integrity });
  }
  for (const entry of entries) {
    const status = await registryStatus(entry.name, entry.version, { registry, fetch });
    entry.published = status === "published";
  }

  const manifest = { packages: entries };
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(outDir, "SHA256SUMS"),
    entries.map(({ sha256, file }) => `${sha256}  ${file}\n`).join(""),
  );
  return manifest;
}

/** The job summary of a pack: one row per tarball, then what will be published. */
export function packSummary(manifest) {
  const unpublished = manifest.packages.filter((entry) => !entry.published);
  const lines = [
    "### Release · packed tarballs",
    "",
    "| Package | Version | On npm | Tarball | sha256 |",
    "| --- | --- | --- | --- | --- |",
    ...manifest.packages.map(
      (entry) =>
        `| ${entry.name} | ${entry.version} | ${entry.published ? "yes" : "**no**"} | ` +
        `\`${entry.file}\` | \`${entry.sha256}\` |`,
    ),
    "",
    unpublished.length === 0
      ? "Nothing to publish: npm already has every version above."
      : `To publish, after the npm-publish deployment is approved: ${unpublished
          .map((entry) => `${entry.name}@${entry.version}`)
          .join(", ")}.`,
  ];
  return `${lines.join("\n")}\n`;
}

/** `key=value` lines for $GITHUB_OUTPUT, and the same on stdout. */
function setOutputs(values) {
  const text = Object.entries(values)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  process.stdout.write(text);
  if (ENV.GITHUB_OUTPUT) appendFileSync(ENV.GITHUB_OUTPUT, text);
}

function addSummary(markdown) {
  if (ENV.GITHUB_STEP_SUMMARY) appendFileSync(ENV.GITHUB_STEP_SUMMARY, markdown);
}

const USAGE = `Usage:
  node scripts/release-packages.mjs state
  node scripts/release-packages.mjs pack <dir> [--registry <url>]`;

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "state" && rest.length === 0) {
    const files = pendingChangesets();
    console.log(
      files.length > 0
        ? `${files.length} pending changesets (${files.join(", ")}): the version PR is opened or updated, and nothing is published.`
        : "No pending changesets: what npm does not have yet may be published.",
    );
    setOutputs({ pending: String(files.length > 0) });
    return 0;
  }
  if (command === "pack") {
    let parsed;
    try {
      parsed = parseArgs({
        args: rest,
        options: { registry: { type: "string", default: REGISTRY } },
        allowPositionals: true,
      });
    } catch (error) {
      console.error(`${error.message}\n${USAGE}`);
      return 2;
    }
    if (parsed.positionals.length !== 1) {
      console.error(USAGE);
      return 2;
    }
    const manifest = await packAll({
      outDir: resolve(parsed.positionals[0]),
      registry: parsed.values.registry,
    });
    for (const entry of manifest.packages) {
      console.log(
        `${entry.published ? "on npm   " : "to publish"} ${entry.name}@${entry.version}  ${entry.file}  sha256 ${entry.sha256}`,
      );
    }
    addSummary(packSummary(manifest));
    setOutputs({
      unpublished: String(manifest.packages.filter((entry) => !entry.published).length),
    });
    return 0;
  }
  console.error(USAGE);
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`::error title=Release::${error.message.split("\n")[0]}`);
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
