import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { publishablePackages } from "./release-packages.mjs";
import {
  changelogEntry,
  githubApi,
  parseReleased,
  releasePlan,
  TAGGER,
  tagAndRelease,
} from "./release-tags.mjs";

const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
const SHA = "5acf1051329470519c9a907f5e45421d30c00f09";
const OTHER_SHA = "c9ec4af8c21a1abaf038f1cb619974664d948ac0";

const CHANGELOG = `# @avakit/core

## 0.2.2

### Patch Changes

- 54b59ec: Hardens wallets.

  \`\`\`ts
  ## 0.2.1
  const notAHeading = true;
  \`\`\`

- 1ea2122: Checks the chain id.

## 0.2.1

### Patch Changes

- c61a23d: Harden chain and wallet safety.

## 0.2.0-rc.1

- Something early.
`;

test("changelogEntry takes the text under the version's heading, up to the next one of its depth", () => {
  assert.equal(
    changelogEntry(CHANGELOG, "0.2.2"),
    [
      "### Patch Changes",
      "",
      "- 54b59ec: Hardens wallets.",
      "",
      "  ```ts",
      "  ## 0.2.1",
      "  const notAHeading = true;",
      "  ```",
      "",
      "- 1ea2122: Checks the chain id.",
    ].join("\n"),
  );
  assert.equal(
    changelogEntry(CHANGELOG, "0.2.1"),
    "### Patch Changes\n\n- c61a23d: Harden chain and wallet safety.",
  );
  // The last entry runs to the end of the file.
  assert.equal(changelogEntry(CHANGELOG, "0.2.0-rc.1"), "- Something early.");
  assert.equal(changelogEntry(CHANGELOG, "9.9.9"), null);
});

test("changelogEntry gives this repository's changelogs what their GitHub releases say", () => {
  // The bodies of the existing releases @avakit/core@0.2.2 and
  // create-avalanche-app@0.4.3, as changesets/action wrote them (2026-11-19).
  const core = readFileSync(join(repoRoot, "packages", "core", "CHANGELOG.md"), "utf8");
  assert.match(
    changelogEntry(core, "0.2.2"),
    /^### Patch Changes\n\n- 54b59ec: Hardens wallets and deploys/,
  );
  assert.match(changelogEntry(core, "0.2.2"), /`AVAKIT_FAUCET_URL`\.$/);
  const cli = readFileSync(
    join(repoRoot, "packages", "create-avalanche-app", "CHANGELOG.md"),
    "utf8",
  );
  assert.match(
    changelogEntry(cli, "0.4.3"),
    /^### Patch Changes\n\n- 8e2ed22: Scaffolded apps now install with npm 10/,
  );
  assert.doesNotMatch(changelogEntry(cli, "0.4.3"), /## 0\.4\.2/);
});

test("parseReleased takes a JSON array of strings and drops repeats", () => {
  assert.deepEqual(
    parseReleased('["@avakit/core@0.2.3","@avakit/core@0.2.3","create-avalanche-app@0.4.4"]'),
    ["@avakit/core@0.2.3", "create-avalanche-app@0.4.4"],
  );
  assert.deepEqual(parseReleased("[]"), []);
  assert.throws(() => parseReleased(""), /not JSON/);
  assert.throws(() => parseReleased('{"a":1}'), /JSON array/);
  assert.throws(() => parseReleased("[1]"), /JSON array/);
});

/** Two packages in a temporary directory: `@scope/lib` (with a changelog) and `tool` (without). */
function packages(t) {
  const root = mkdtempSync(join(tmpdir(), "avakit-tags-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "lib"));
  mkdirSync(join(root, "tool"));
  writeFileSync(
    join(root, "lib", "CHANGELOG.md"),
    "# @scope/lib\n\n## 1.1.0-beta.0\n\n- New.\n\n## 1.0.0\n\n- Old.\n",
  );
  return [
    { name: "@scope/lib", version: "1.1.0-beta.0", dir: join(root, "lib") },
    { name: "tool", version: "3.0.0", dir: join(root, "tool") },
  ];
}

test("releasePlan follows package order, reads the notes from this checkout, and refuses anything else", (t) => {
  const list = packages(t);
  assert.deepEqual(releasePlan(["tool@3.0.0", "@scope/lib@1.1.0-beta.0"], list), [
    {
      tag: "@scope/lib@1.1.0-beta.0",
      name: "@scope/lib",
      version: "1.1.0-beta.0",
      prerelease: true,
      body: "- New.",
    },
    { tag: "tool@3.0.0", name: "tool", version: "3.0.0", prerelease: false, body: null },
  ]);
  assert.throws(
    () => releasePlan(["tool@2.9.9"], list),
    /tool@2\.9\.9 is not a publishable package of this commit/,
  );
  assert.throws(() => releasePlan(["left-pad@1.0.0"], list), /left-pad@1\.0\.0 is not/);
  writeFileSync(join(list[0].dir, "CHANGELOG.md"), "# @scope/lib\n\n## 1.0.0\n\n- Old.\n");
  assert.throws(
    () => releasePlan(["@scope/lib@1.1.0-beta.0"], list),
    /has no entry for 1\.1\.0-beta\.0/,
  );
});

test("releasePlan accepts every package of this commit at its own version", () => {
  const list = publishablePackages(repoRoot);
  const plan = releasePlan(
    list.map(({ name, version }) => `${name}@${version}`),
    list,
  );
  assert.equal(plan.length, 5);
  for (const item of plan) assert.equal(typeof item.body, "string");
});

/** An in-memory GitHub: `tags` maps a tag name to the commit it is on. */
function fakeApi({ tags = {}, releases = [] } = {}) {
  const calls = [];
  const objects = new Map();
  const api = {
    getTagRef: async (tag) => {
      calls.push(["getTagRef", tag]);
      if (!(tag in tags)) return null;
      objects.set(`obj-${tag}`, tags[tag]);
      return { object: { type: "tag", sha: `obj-${tag}` } };
    },
    getTagObject: async (sha) => {
      calls.push(["getTagObject", sha]);
      return { object: { type: "commit", sha: objects.get(sha) } };
    },
    createTagObject: async (body) => {
      calls.push(["createTagObject", body]);
      return { sha: `new-${body.tag}` };
    },
    createRef: async (body) => {
      calls.push(["createRef", body]);
      return {};
    },
    getRelease: async (tag) => {
      calls.push(["getRelease", tag]);
      return releases.includes(tag) ? { tag_name: tag } : null;
    },
    createRelease: async (body) => {
      calls.push(["createRelease", body]);
      return {};
    },
  };
  return { api, calls };
}

const PLAN = [
  { tag: "@avakit/core@0.2.3", prerelease: false, body: "### Patch Changes\n\n- Fixed." },
  { tag: "tool@1.0.0", prerelease: false, body: null },
];
const now = () => new Date("2026-11-21T12:00:00.000Z");

test("tagAndRelease creates an annotated tag and a release exactly as changesets/action did", async () => {
  const { api, calls } = fakeApi();
  const done = await tagAndRelease({ plan: PLAN, api, sha: SHA, now, log: () => {} });
  assert.deepEqual(done, [
    "tag @avakit/core@0.2.3",
    "release @avakit/core@0.2.3",
    "tag tool@1.0.0",
  ]);
  assert.deepEqual(
    calls.filter(([call]) => call.startsWith("create")),
    [
      [
        "createTagObject",
        {
          tag: "@avakit/core@0.2.3",
          message: "@avakit/core@0.2.3\n",
          object: SHA,
          type: "commit",
          tagger: { ...TAGGER, date: "2026-11-21T12:00:00.000Z" },
        },
      ],
      ["createRef", { ref: "refs/tags/@avakit/core@0.2.3", sha: "new-@avakit/core@0.2.3" }],
      [
        "createRelease",
        {
          tag_name: "@avakit/core@0.2.3",
          name: "@avakit/core@0.2.3",
          body: "### Patch Changes\n\n- Fixed.",
          prerelease: false,
        },
      ],
      // A package without a changelog gets its tag and no release.
      [
        "createTagObject",
        {
          tag: "tool@1.0.0",
          message: "tool@1.0.0\n",
          object: SHA,
          type: "commit",
          tagger: { ...TAGGER, date: "2026-11-21T12:00:00.000Z" },
        },
      ],
      ["createRef", { ref: "refs/tags/tool@1.0.0", sha: "new-tool@1.0.0" }],
    ],
  );
  assert.deepEqual(TAGGER, {
    name: "github-actions[bot]",
    email: "41898282+github-actions[bot]@users.noreply.github.com",
  });
});

test("tagAndRelease finishes what an earlier run started, and never moves a tag", async () => {
  const resumed = fakeApi({ tags: { "@avakit/core@0.2.3": SHA }, releases: [] });
  assert.deepEqual(
    await tagAndRelease({ plan: PLAN.slice(0, 1), api: resumed.api, sha: SHA, now, log: () => {} }),
    ["release @avakit/core@0.2.3"],
  );
  const finished = fakeApi({
    tags: { "@avakit/core@0.2.3": SHA },
    releases: ["@avakit/core@0.2.3"],
  });
  assert.deepEqual(
    await tagAndRelease({
      plan: PLAN.slice(0, 1),
      api: finished.api,
      sha: SHA,
      now,
      log: () => {},
    }),
    [],
  );

  const elsewhere = fakeApi({ tags: { "@avakit/core@0.2.3": OTHER_SHA } });
  await assert.rejects(
    tagAndRelease({ plan: PLAN.slice(0, 1), api: elsewhere.api, sha: SHA, now, log: () => {} }),
    /already exists on c9ec4af8.*not moved/,
  );
  assert.equal(elsewhere.calls.filter(([call]) => call.startsWith("create")).length, 0);
  await assert.rejects(
    tagAndRelease({ plan: PLAN, api: fakeApi().api, sha: "main", log: () => {} }),
    /not a commit/,
  );
});

test("githubApi speaks to the GitHub REST API with the token and reads a 404 as nothing", async () => {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, ...init });
    if (url.endsWith("/releases/tags/%40avakit%2Fcore%400.2.3"))
      return { ok: false, status: 404, text: async () => "" };
    if (init.method === "POST") return { ok: true, status: 201, text: async () => '{"sha":"abc"}' };
    return { ok: false, status: 500, text: async () => "boom" };
  };
  const api = githubApi({
    token: "t0ken",
    repository: "owner/repo",
    apiUrl: "https://api.example/",
    fetch,
  });
  assert.equal(await api.getRelease("@avakit/core@0.2.3"), null);
  assert.deepEqual(await api.createRef({ ref: "refs/tags/x", sha: "abc" }), { sha: "abc" });
  await assert.rejects(
    api.getTagRef("x@1.0.0"),
    /GET git\/ref\/tags\/x%401\.0\.0 answered HTTP 500: boom/,
  );
  assert.equal(
    requests[0].url,
    "https://api.example/repos/owner/repo/releases/tags/%40avakit%2Fcore%400.2.3",
  );
  assert.equal(requests[0].headers.authorization, "Bearer t0ken");
  assert.equal(requests[1].url, "https://api.example/repos/owner/repo/git/refs");
  assert.equal(requests[1].body, '{"ref":"refs/tags/x","sha":"abc"}');
  assert.throws(() => githubApi({ token: "", repository: "owner/repo" }), /GITHUB_TOKEN/);
  assert.throws(() => githubApi({ token: "x", repository: "owner" }), /owner\/repo/);
});
