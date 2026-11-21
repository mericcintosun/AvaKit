// Tag the release: for every package the publish job of
// .github/workflows/release.yml put on npm, create the git tag and the GitHub
// release that changesets/action created when it still published, and in the
// same shape:
//
//   - an annotated tag `<name>@<version>` (for example `@avakit/core@0.2.3`),
//     whose message is the tag name, tagged by github-actions[bot], on the
//     commit that was released;
//   - a release of that tag, named after it, whose body is the package's
//     CHANGELOG.md entry for that version, marked as a prerelease when the
//     version has a `-` in it. A package without a CHANGELOG.md gets the tag
//     and no release, as before.
//
// Usage (the tag job of release.yml):
//   RELEASED='["@avakit/core@0.2.3"]' node scripts/release-tags.mjs
// with GITHUB_TOKEN (contents: write), GITHUB_REPOSITORY, GITHUB_SHA and,
// optionally, GITHUB_API_URL in the environment.
//
// RELEASED is what the publish job reports, and everything else comes from
// this checkout: a name@version that is not a publishable package of this
// commit at that version is refused, and the release notes are read from the
// CHANGELOG.md here, not from the tarball artifact. A tag that already exists
// on this commit is kept, one on another commit fails the job (it is never
// moved), and a release that already exists is left alone, so a re-run
// finishes what a failed run started.
//
// The changelog entry is found the way changesets/action finds it
// (getChangelogEntry in its src/utils.ts), with one difference: when the
// changelog has no heading for the version, the action used the whole file as
// the body, and this fails instead.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishablePackages } from "./release-packages.mjs";

/** Who changesets/action committed and tagged as (its setupUser). */
export const TAGGER = {
  name: "github-actions[bot]",
  email: "41898282+github-actions[bot]@users.noreply.github.com",
};

/**
 * The CHANGELOG.md entry for `version`: the text between its heading and the
 * next heading of the same depth, trimmed, or null when there is no heading
 * for it. Headings inside fenced code blocks do not count.
 */
export function changelogEntry(changelog, version) {
  const heading = /^(#{1,6})\s(.*)$|^(`{3,})/gm;
  let start;
  let depth;
  let end;
  let match = heading.exec(changelog);
  while (match !== null) {
    if (match[3]) {
      const fence = new RegExp(`^${match[3]}`, "gm");
      fence.lastIndex = heading.lastIndex;
      if (fence.exec(changelog) === null) break;
      heading.lastIndex = fence.lastIndex;
    } else if (match[2].trim() === version) {
      start = heading.lastIndex;
      depth = match[1].length;
    } else if (start !== undefined && match[1].length === depth) {
      end = match.index;
      break;
    }
    match = heading.exec(changelog);
  }
  return start === undefined ? null : changelog.slice(start, end).trim();
}

/** The `name@version` strings of RELEASED, which must be a JSON array of them. */
export function parseReleased(text) {
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    throw new Error(`RELEASED is not JSON: ${String(text).slice(0, 200)}`);
  }
  if (!Array.isArray(list) || !list.every((item) => typeof item === "string")) {
    throw new Error("RELEASED must be a JSON array of name@version strings");
  }
  return [...new Set(list)];
}

/**
 * What to tag: `[{ tag, name, version, prerelease, body }]` in package order.
 * `body` is the release notes, or null when the package has no CHANGELOG.md.
 */
export function releasePlan(released, packages) {
  const byTag = new Map(packages.map((pkg) => [`${pkg.name}@${pkg.version}`, pkg]));
  for (const tag of released) {
    if (!byTag.has(tag)) {
      throw new Error(
        `${tag} is not a publishable package of this commit at that version ` +
          `(this commit has ${[...byTag.keys()].join(", ")})`,
      );
    }
  }
  return packages
    .filter((pkg) => released.includes(`${pkg.name}@${pkg.version}`))
    .map((pkg) => {
      const tag = `${pkg.name}@${pkg.version}`;
      const file = join(pkg.dir, "CHANGELOG.md");
      let body = null;
      if (existsSync(file)) {
        body = changelogEntry(readFileSync(file, "utf8"), pkg.version);
        if (body === null) throw new Error(`${file} has no entry for ${pkg.version}`);
      }
      return {
        tag,
        name: pkg.name,
        version: pkg.version,
        prerelease: pkg.version.includes("-"),
        body,
      };
    });
}

/** The few GitHub REST calls tagging needs. A GET that finds nothing returns null. */
export function githubApi(options) {
  const {
    token,
    repository,
    apiUrl = "https://api.github.com",
    fetch = globalThis.fetch,
  } = options;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? ""))
    throw new Error("GITHUB_REPOSITORY is not owner/repo");
  const request = async (method, path, body) => {
    const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/repos/${repository}/${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "avakit-release-tags",
        "x-github-api-version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (method === "GET" && response.status === 404) return null;
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} answered HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    return text ? JSON.parse(text) : null;
  };
  return {
    getTagRef: (tag) => request("GET", `git/ref/tags/${encodeURIComponent(tag)}`),
    getTagObject: (sha) => request("GET", `git/tags/${sha}`),
    createTagObject: (body) => request("POST", "git/tags", body),
    createRef: (body) => request("POST", "git/refs", body),
    getRelease: (tag) => request("GET", `releases/tags/${encodeURIComponent(tag)}`),
    createRelease: (body) => request("POST", "releases", body),
  };
}

/** Create what is missing of each planned tag and release; returns what was done. */
export async function tagAndRelease({ plan, api, sha, now = () => new Date(), log = console.log }) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error(`GITHUB_SHA is not a commit: ${sha}`);
  const done = [];
  for (const { tag, prerelease, body } of plan) {
    const ref = await api.getTagRef(tag);
    if (ref) {
      const target =
        ref.object.type === "tag"
          ? (await api.getTagObject(ref.object.sha)).object.sha
          : ref.object.sha;
      if (target !== sha) {
        throw new Error(`tag ${tag} already exists on ${target}, not on ${sha}, and is not moved`);
      }
      log(`tag ${tag}: already on this commit`);
    } else {
      const object = await api.createTagObject({
        tag,
        message: `${tag}\n`,
        object: sha,
        type: "commit",
        tagger: { ...TAGGER, date: now().toISOString() },
      });
      await api.createRef({ ref: `refs/tags/${tag}`, sha: object.sha });
      log(`tag ${tag}: created on ${sha}`);
      done.push(`tag ${tag}`);
    }
    if (body === null) {
      log(`release ${tag}: none, the package has no CHANGELOG.md`);
    } else if (await api.getRelease(tag)) {
      log(`release ${tag}: already exists`);
    } else {
      await api.createRelease({ tag_name: tag, name: tag, body, prerelease });
      log(`release ${tag}: created`);
      done.push(`release ${tag}`);
    }
  }
  return done;
}

async function main() {
  const env = process.env;
  const released = parseReleased(env.RELEASED ?? "");
  if (released.length === 0) {
    console.log("Nothing was published, so there is nothing to tag.");
    return;
  }
  const plan = releasePlan(released, publishablePackages());
  const api = githubApi({
    token: env.GITHUB_TOKEN,
    repository: env.GITHUB_REPOSITORY,
    apiUrl: env.GITHUB_API_URL,
  });
  await tagAndRelease({ plan, api, sha: env.GITHUB_SHA });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error title=Release tags::${error.message.split("\n")[0]}`);
    console.error(error.message);
    process.exitCode = 1;
  });
}
