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
// pinnedFile() reads one file the same way: eerc-pin.mjs reads the files of
// ava-labs/EncryptedERC it checks through it, pinned in
// contracts-ci/upstream/EncryptedERC/sources.json (nothing is built from those).
//
// Moving a pin: change the commit (and tag) of the first repository in
// sources.json, then
//   node scripts/upstream.mjs pin <name>
// reads the submodule commits from that commit, follows the imports of the
// listed contracts through the remappings in foundry.toml and rewrites the
// rest of sources.json. It reads GitHub's API (set GITHUB_TOKEN past its
// anonymous rate limit). Then regenerate: node scripts/check-artifacts.mjs --write
// (EncryptedERC is re-pinned by eerc-pin.mjs instead: see that file.)
//
// Every request goes through download(), which retries what a busy or briefly
// unreachable GitHub answers and sends GITHUB_TOKEN (or GH_TOKEN), when one is
// set, to GitHub's hosts and to nothing else.

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

/** Where a file of the layout is served at its repository's pinned commit. */
export const rawUrl = (repository, path) =>
  `https://raw.githubusercontent.com/${repository.repository}/${repository.commit}/${inRepository(repository, path)}`;

/** A download that did not complete: the network or GitHub failed, so nothing
 * was compared. A file that arrives but is not the pinned one is a plain Error. */
export class FetchError extends Error {
  constructor(message) {
    super(message);
    this.name = "FetchError";
  }
}

// Seconds to wait before each retry of a request (Retry-After, when GitHub
// sends one, instead). A longer Retry-After than LONGEST_WAIT is a rate limit
// that outlasts a CI job, so it fails the download at once.
const RETRY_DELAYS = [1, 2, 4, 8, 16];
const LONGEST_WAIT = 60;
// A request that has not completed after this long is dropped and retried:
// long enough for the largest circuit file (15 MB) at 250 KB/s, short enough
// that a GitHub that stalls fails a CI job in minutes.
const REQUEST_TIMEOUT_MS = 60_000;
// GITHUB_TOKEN lifts the anonymous rate limit of these hosts. It goes nowhere
// else: fetch drops the header on a redirect to another origin.
const GITHUB_HOSTS = new Set(["raw.githubusercontent.com", "api.github.com"]);

const pause = (seconds) => new Promise((done) => setTimeout(done, seconds * 1000));

/** The seconds a response's Retry-After header asks for, or undefined. */
function retryAfter(response) {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1000;
  return Number.isNaN(seconds) ? undefined : Math.max(0, Math.ceil(seconds));
}

/**
 * The body of a GET. A dropped connection, a timeout, HTTP 408, 429 or 5xx is
 * retried up to five times, after 1, 2, 4, 8 and 16 s or what Retry-After asks;
 * any other answer fails at once. With GITHUB_TOKEN (or GH_TOKEN) set, a GitHub
 * host gets it; one that GitHub refuses (401, 403, 404: a public file answers
 * 404 to a bad token) is dropped and the request made again without it.
 * Throws a FetchError. `sleep` is for tests.
 */
export async function download(url, { headers = {}, sleep = pause } = {}) {
  const token = ENV.GITHUB_TOKEN || ENV.GH_TOKEN;
  let authorize = Boolean(token) && GITHUB_HOSTS.has(new URL(url).hostname);
  let failure;
  let attempt = 0;
  for (;;) {
    let wait = RETRY_DELAYS[attempt];
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "avakit-contracts-ci",
          ...headers,
          ...(authorize ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      if (response.body) await response.body.cancel().catch(() => {});
      failure = `HTTP ${response.status}`;
      if (authorize && [401, 403, 404].includes(response.status)) {
        authorize = false;
        continue;
      }
      if (response.status !== 408 && response.status !== 429 && response.status < 500) break;
      const asked = retryAfter(response);
      if (asked > LONGEST_WAIT) {
        failure += `, asked to retry after ${asked} s`;
        break;
      }
      wait = asked ?? wait;
    } catch (error) {
      failure = error.name === "TimeoutError" ? "timed out" : (error.cause?.code ?? error.message);
    }
    if (attempt === RETRY_DELAYS.length) break;
    attempt++;
    await sleep(wait);
  }
  const tries = attempt + 1;
  throw new FetchError(
    `could not fetch ${url} (${failure}${tries > 1 ? `, ${tries} attempts` : ""})`,
  );
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
 * have it either: the pin and the upstream repository disagree. A download
 * that fails throws a FetchError. */
export async function pinnedBytes(repository, path, id) {
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

/** Refuse an entry of a pin that could name a file outside the layout or the
 * cache: the path is laid out as given, the blob id names the cached copy. */
function checkEntry(name, path, id) {
  if (posix.normalize(path) !== path || path.startsWith("../") || posix.isAbsolute(path)) {
    throw new Error(`${name}: ${path} is not a plain relative path`);
  }
  if (!/^[0-9a-f]{40}$/.test(id)) throw new Error(`${name}: ${path} has no git blob id`);
}

/** The bytes of the file at `path` of the pinned project `name`, checked
 * against its blob id like every file materialize() lays out. */
export async function pinnedFile(name, path, pin = readPin(name)) {
  const id = pin.files?.[path];
  if (id === undefined) throw new Error(`${name}: sources.json pins no ${path}`);
  checkEntry(name, path, id);
  return pinnedBytes(repositoryOf(pin.repositories, path), path, id);
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
  for (const [path, id] of files) checkEntry(name, path, id);
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

/** A GET of GitHub's REST API, as JSON. */
export async function githubJson(path) {
  const body = await download(`https://api.github.com/${path}`, {
    headers: { accept: "application/vnd.github+json" },
  });
  return JSON.parse(body.toString("utf8"));
}

/** `prefix=target` pairs of the `remappings` array in a foundry.toml. */
function remappingsOf(toml) {
  const list = toml.match(/^remappings\s*=\s*\[([\s\S]*?)\]/m)?.[1];
  if (list === undefined) throw new Error("foundry.toml has no remappings array");
  return [...list.matchAll(/"([^"=]+)=([^"]+)"/g)].map(([, prefix, target]) => [prefix, target]);
}

/** `text` (Solidity or TypeScript) without its comments, so that what is read
 * from it is code. Strings are not parsed: a "//" or "/*" inside one is taken
 * for the start of a comment. That is enough for the upstream files read this
 * way, whose new versions are reviewed whenever a pin moves. */
export const withoutComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Every path a Solidity file imports, comments aside. A file this misses
 * fails the build, so the pin can be incomplete only loudly. */
export function importsOf(text) {
  return [
    ...withoutComments(text).matchAll(/^\s*import\s+(?:[^;"']*?\bfrom\s+)?["']([^"']+)["']/gm),
  ].map((match) => match[1]);
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
