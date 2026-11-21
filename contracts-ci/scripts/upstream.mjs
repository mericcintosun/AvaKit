// The sources of the contracts the repo ships but did not write, pinned so that
// check-artifacts.mjs can build them and compare the build with what ships.
//
// token-bridge bundles three contracts compiled from ava-labs/icm-contracts
// (ERC20TokenHome, ERC20TokenRemote, TeleporterRegistry). That code is not
// vendored here on purpose: it is under Ava Labs' Ecosystem License, not MIT.
// What the repo holds is the recipe, in contracts-ci/upstream/<name>/:
//
//   sources.json   the repositories, each at a commit and mounted where a
//                  recursive checkout puts it, and every source file the build
//                  reads, by the git blob id it has at that commit
//   foundry.toml   the compiler settings and remappings of the build
//
// materialize() lays those files out in a directory as a recursive checkout
// would and checks every one against its blob id, so the build reads exactly
// the pinned bytes or does not run. A file is fetched from
// raw.githubusercontent.com once and then kept in a cache named by its blob id
// ($AVAKIT_UPSTREAM_CACHE, by default <tmpdir>/avakit-upstream-sources); a
// cached copy is checked like a fetched one, and replaced when it fails.
//
// Moving a pin: change the commit (and tag) of the first repository in
// sources.json, then
//   node scripts/upstream.mjs pin <name>
// reads the submodule commits from that commit, follows the imports of the
// listed contracts through the remappings in foundry.toml and rewrites the
// rest of sources.json. It reads GitHub's API (set GITHUB_TOKEN past its
// anonymous rate limit). Then regenerate: node scripts/check-artifacts.mjs --write

import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const UPSTREAM_DIR = resolve(here, "..", "upstream");
const ENV = process.env;

/** The id git gives a file's content: sha1 over "blob <size>\0" + the bytes. */
export function blobId(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** The pin of an upstream project: its sources.json, parsed. */
export function readPin(name) {
  return JSON.parse(readFileSync(join(UPSTREAM_DIR, name, "sources.json"), "utf8"));
}

/** How a pin is named in output: the top repository, its tag and commit. */
export function describePin(pin) {
  const top = pin.repositories.find((repository) => repository.path === "");
  return `${top.repository}${top.tag ? ` ${top.tag}` : ""} @ ${top.commit.slice(0, 12)}`;
}

/** The repository a path of the layout belongs to: the one mounted deepest
 * above it, as in a checkout where submodules sit inside their parents. */
function repositoryOf(repositories, path) {
  const holders = repositories.filter(
    (repository) => repository.path === "" || path.startsWith(`${repository.path}/`),
  );
  if (holders.length === 0) throw new Error(`no repository is mounted above ${path}`);
  return holders.reduce((deepest, next) =>
    next.path.length > deepest.path.length ? next : deepest,
  );
}

/** The path of a layout file inside its own repository. */
const inRepository = (repository, path) =>
  repository.path === "" ? path : path.slice(repository.path.length + 1);

const rawUrl = (repository, path) =>
  `https://raw.githubusercontent.com/${repository.repository}/${repository.commit}/${inRepository(repository, path)}`;

/** The body of a GET, retried twice on a network error or a server error. */
export async function download(url) {
  let failure;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      failure = `HTTP ${response.status}`;
      if (response.status === 404) break; // a missing path does not appear on retry
    } catch (error) {
      failure = error.cause?.code ?? error.message;
    }
    await new Promise((done) => setTimeout(done, 500 * attempt));
  }
  throw new Error(`could not download ${url} (${failure})`);
}

/** Where fetched upstream files are kept between runs. */
export const cacheDir = () =>
  ENV.AVAKIT_UPSTREAM_CACHE || join(tmpdir(), "avakit-upstream-sources");

/** Put `bytes` at `path` in one step, so a concurrent run never reads half a file. */
export function writeAtomically(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.${process.pid}.partial`;
  writeFileSync(partial, bytes);
  renameSync(partial, path);
}

/** The bytes of one pinned file: from the cache when the copy there still has
 * the pinned blob id, from GitHub otherwise. Fails when GitHub's copy does not
 * have it either: the pin and the upstream repository disagree. */
async function pinnedBytes(repository, path, id) {
  const cached = join(cacheDir(), id);
  try {
    const bytes = readFileSync(cached);
    if (blobId(bytes) === id) return bytes;
    rmSync(cached, { force: true }); // damaged or tampered with: fetch it again
  } catch {
    // not cached yet
  }
  const url = rawUrl(repository, path);
  const bytes = await download(url);
  const got = blobId(bytes);
  if (got !== id) {
    throw new Error(`${path}: ${url} has blob ${got}, the pin says ${id}`);
  }
  writeAtomically(cached, bytes);
  return bytes;
}

/**
 * Lay the pinned project `name` out in `into` (its foundry.toml and every
 * source file, each checked against its blob id) and return `into`, ready for
 * `forge build --root`. Throws when a file cannot be fetched or does not match.
 */
export async function materialize(name, into) {
  const pin = readPin(name);
  const files = Object.entries(pin.files ?? {});
  if (files.length === 0) throw new Error(`${name}: sources.json lists no files`);
  for (const [path, id] of files) {
    if (posix.normalize(path) !== path || path.startsWith("../") || posix.isAbsolute(path)) {
      throw new Error(`${name}: ${path} is not a plain relative path`);
    }
    if (!/^[0-9a-f]{40}$/.test(id)) throw new Error(`${name}: ${path} has no git blob id`);
  }
  const contents = await Promise.all(
    files.map(([path, id]) => pinnedBytes(repositoryOf(pin.repositories, path), path, id)),
  );
  mkdirSync(into, { recursive: true });
  copyFileSync(join(UPSTREAM_DIR, name, "foundry.toml"), join(into, "foundry.toml"));
  files.forEach(([path], i) => {
    mkdirSync(dirname(join(into, path)), { recursive: true });
    writeFileSync(join(into, path), contents[i]);
  });
  return into;
}

// ---- pin: rebuild sources.json from the commit of its first repository ----

async function githubJson(path) {
  const headers = { accept: "application/vnd.github+json", "user-agent": "avakit-contracts-ci" };
  const token = ENV.GITHUB_TOKEN || ENV.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com/${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub API ${path}: HTTP ${response.status}`);
  return response.json();
}

/** `prefix=target` pairs of the `remappings` array in a foundry.toml. */
function remappingsOf(toml) {
  const list = toml.match(/^remappings\s*=\s*\[([\s\S]*?)\]/m)?.[1];
  if (list === undefined) throw new Error("foundry.toml has no remappings array");
  return [...list.matchAll(/"([^"=]+)=([^"]+)"/g)].map(([, prefix, target]) => [prefix, target]);
}

/** Every path a Solidity file imports, comments aside. A file this misses
 * fails the build, so the pin can be incomplete only loudly. */
export function importsOf(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  return [...code.matchAll(/^\s*import\s+(?:[^;"']*?\bfrom\s+)?["']([^"']+)["']/gm)].map(
    (match) => match[1],
  );
}

async function pin(name) {
  const file = join(UPSTREAM_DIR, name, "sources.json");
  const previous = readPin(name);
  const top = previous.repositories.find((repository) => repository.path === "");
  if (!top) throw new Error(`${file}: no repository is mounted at the top (path "")`);
  const remappings = remappingsOf(readFileSync(join(UPSTREAM_DIR, name, "foundry.toml"), "utf8"));

  // Repositories are loaded as the imports reach into them: the top one, and
  // each submodule (a gitlink in its parent's tree) the first time a path
  // below its mount point is needed.
  const repositories = [{ ...top, path: "" }];
  const trees = new Map(); // mount path -> Map(path in repository -> entry)
  const loadTree = async (repository) => {
    const tree = await githubJson(
      `repos/${repository.repository}/git/trees/${repository.commit}?recursive=1`,
    );
    if (tree.truncated) throw new Error(`${repository.repository}: the tree is too big to list`);
    trees.set(repository.path, new Map(tree.tree.map((entry) => [entry.path, entry])));
  };
  await loadTree(repositories[0]);

  const mount = async (path) => {
    for (;;) {
      const holder = repositoryOf(repositories, path);
      const relative = inRepository(holder, path);
      const tree = trees.get(holder.path);
      // A gitlink on the way down means the path is inside a submodule.
      const parts = relative.split("/");
      const link = parts
        .map((_, i) => parts.slice(0, i + 1).join("/"))
        .find((prefix) => tree.get(prefix)?.type === "commit");
      if (link === undefined) return holder;
      const modules = (await download(rawUrl(holder, posix.join(holder.path, ".gitmodules"))))
        .toString("utf8")
        .split(/^\[submodule /m);
      const section = modules.find((text) =>
        text.split("\n").some((line) => line.trim().replace(/\s*=\s*/, "=") === `path=${link}`),
      );
      const url = section?.match(/^\s*url\s*=\s*(\S+)\s*$/m)?.[1];
      const repository = url?.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1];
      if (!repository) {
        throw new Error(`${holder.repository}: cannot tell where submodule ${link} comes from`);
      }
      const commit = tree.get(link).sha;
      const mountPath = holder.path === "" ? link : `${holder.path}/${link}`;
      // A tag is kept for a submodule whose commit did not move; a new commit
      // gets none, since nothing here can tell which tag (if any) it is.
      const known = previous.repositories.find((r) => r.path === mountPath && r.commit === commit);
      const added = {
        path: mountPath,
        repository,
        ...(known?.tag ? { tag: known.tag } : {}),
        commit,
      };
      repositories.push(added);
      await loadTree(added);
    }
  };

  const files = new Map();
  const queue = [...previous.contracts];
  while (queue.length > 0) {
    const path = queue.shift();
    if (files.has(path)) continue;
    const holder = await mount(path);
    const entry = trees.get(holder.path).get(inRepository(holder, path));
    if (entry?.type !== "blob")
      throw new Error(`${path} is not a file in ${holder.repository}@${holder.commit}`);
    const bytes = await download(rawUrl(holder, path));
    if (blobId(bytes) !== entry.sha)
      throw new Error(`${path}: the download does not match the git tree`);
    files.set(path, entry.sha);
    for (const spec of importsOf(bytes.toString("utf8"))) {
      if (spec.startsWith("./") || spec.startsWith("../")) {
        queue.push(posix.normalize(posix.join(posix.dirname(path), spec)));
        continue;
      }
      const [prefix, target] =
        remappings
          .filter(([from]) => spec.startsWith(from))
          .reduce(
            (best, next) => (next[0].length > (best?.[0].length ?? -1) ? next : best),
            undefined,
          ) ?? [];
      if (prefix === undefined)
        throw new Error(`${path} imports ${spec}, which no remapping covers`);
      queue.push(target + spec.slice(prefix.length));
    }
  }

  const next = {
    ...previous,
    repositories: repositories.sort((a, b) => a.path.localeCompare(b.path)),
    files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`pinned ${files.size} files of ${describePin(next)} in ${file}`);
  console.log(
    "Now: pnpm biome format --write contracts-ci/upstream && node scripts/check-artifacts.mjs --write",
  );
}

// Run as a script, not imported (real paths: see the same check in eerc-pin.mjs).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, name] = process.argv.slice(2);
  if (command !== "pin" || !name) {
    console.error(
      "Usage: node scripts/upstream.mjs pin <name>   (a directory of contracts-ci/upstream)",
    );
    process.exit(2);
  }
  pin(name).catch((error) => {
    console.error(`PIN FAILED: ${error.message}`);
    process.exit(1);
  });
}
