// Tripwires for the properties of the workflow files that must not be lost
// quietly.
//
// release.yml: nothing is versioned or published before lint, typecheck, the
// tests, the changeset check and the MCP install smoke test have passed; the
// tarballs are packed in a job of their own that runs nothing but the build;
// each job holds only the permissions it needs, and none can start another
// workflow; the one job that can publish runs in the npm-publish environment,
// checks out nothing, installs nothing and runs no code of this repository;
// and its shell steps do what they say, which the last tests check by running
// them against fixture tarballs.
//
// e2e-fuji.yml: every job has a timeout, and only the report job, which keeps
// the e2e-failure issue, can write to issues.
//
// The files are read as text, not parsed: the repo has no YAML dependency,
// and the workflows are written in one regular shape (two-space indents, jobs
// under `jobs:`, steps as `- name:` lists, shared steps as `&anchor` and
// `*alias`). If you restructure a workflow, keep the guarantees and update
// these tests with it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ARTIFACT_PREFIX, legKey } from "./e2e-fuji-report.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Line endings are normalised so a checkout with CRLF reads the same.
const read = (name) =>
  readFileSync(join(root, ".github", "workflows", name), "utf8").replace(/\r\n/g, "\n");
const release = read("release.yml");
const e2e = read("e2e-fuji.yml");

// ── Reading a workflow as text ───────────────────────────────────────────────

/** Each job under `jobs:`, by id, as the text below its `  <id>:` line. */
function jobsOf(text) {
  const lines = text.split("\n");
  const jobs = new Map();
  let current = null;
  for (const line of lines.slice(lines.indexOf("jobs:") + 1)) {
    const header = /^ {2}([\w-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      jobs.set(current, []);
    } else if (/^\S/.test(line)) {
      break;
    } else if (current) {
      jobs.get(current).push(line);
    }
  }
  return new Map([...jobs].map(([id, body]) => [id, body.join("\n")]));
}

/** Every step defined with an `&anchor` anywhere in the file, by anchor name. */
function anchorsOf(text) {
  const anchors = new Map();
  for (const job of jobsOf(text).values()) {
    for (const step of rawStepsOf(job)) {
      const anchor = /^ {6}- &([\w-]+)\s*$/m.exec(step.split("\n")[0]);
      if (anchor) anchors.set(anchor[1], step);
    }
  }
  return anchors;
}

/** A job's steps as written, `*alias` lines included. */
function rawStepsOf(jobText) {
  const lines = jobText.split("\n");
  const steps = [];
  for (const line of lines.slice(lines.findIndex((l) => /^ {4}steps:\s*$/.test(l)) + 1)) {
    if (/^ {6}- /.test(line)) steps.push([line]);
    else if (/^ {0,5}\S/.test(line)) break;
    else if (steps.length > 0) steps.at(-1).push(line);
  }
  return steps.map((step) => step.join("\n").trimEnd());
}

/** A job's steps with every `*alias` replaced by the step it names. */
function stepsOf(text, jobId) {
  const job = jobsOf(text).get(jobId);
  assert.ok(job !== undefined, `no job ${jobId}`);
  const anchors = anchorsOf(text);
  return rawStepsOf(job).map((step) => {
    const alias = /^ {6}- \*([\w-]+)\s*$/.exec(step);
    if (!alias) return step;
    assert.ok(anchors.has(alias[1]), `*${alias[1]} names no anchored step`);
    return anchors.get(alias[1]);
  });
}

const nameOf = (step) => /^ {6}- name: (.+)$|^ {8}name: (.+)$/m.exec(step)?.slice(1).find(Boolean);
const usesOf = (step) => /^ {6}(?:- | {2})uses: (\S+)/m.exec(step)?.[1] ?? null;

/** A step's shell script: the `run: |` block, dedented, or a one-line `run:`. */
function runOf(step) {
  const lines = step.split("\n");
  const at = lines.findIndex((line) => /^ {6}(?:- | {2})run: /.test(line));
  if (at === -1) return null;
  const inline = /run: (.*)$/.exec(lines[at])[1];
  if (inline !== "|") return inline;
  const block = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== "" && !line.startsWith(" ".repeat(10))) break;
    block.push(line.slice(10));
  }
  return `${block.join("\n").trimEnd()}\n`;
}

/** A job-level scalar such as `if`, `needs` or `environment`, or null. */
const jobField = (text, jobId, field) =>
  new RegExp(`^ {4}${field}: (.+)$`, "m").exec(jobsOf(text).get(jobId))?.[1] ?? null;

/** A job's `permissions:` as `{ scope: level }`; `{}` for `permissions: {}`. */
function permissionsOf(text, jobId) {
  const lines = jobsOf(text).get(jobId).split("\n");
  const at = lines.findIndex((line) => /^ {4}permissions:/.test(line));
  if (at === -1) return null;
  if (/^ {4}permissions: \{\}\s*$/.test(lines[at])) return {};
  const permissions = {};
  for (const line of lines.slice(at + 1)) {
    const entry = /^ {6}([\w-]+): (read|write|none)\s*(?:#.*)?$/.exec(line);
    if (!entry) break;
    permissions[entry[1]] = entry[2];
  }
  return permissions;
}

/** Every `uses:` in a workflow, with the comment after it. */
const usesLines = (text) => [...text.matchAll(/^\s+(?:- )?uses: (.+)$/gm)].map((match) => match[1]);

/** How many lines of a workflow, comments aside, grant `scope: write`. */
const grants = (text, scope) =>
  [...text.matchAll(new RegExp(`^ +${scope}: write\\b`, "gm"))].length;

// ── release.yml ──────────────────────────────────────────────────────────────

const RELEASE_JOBS = ["verify", "version", "pack", "publish", "tag", "publish-dry-run"];

/** A job's `needs:`, `needs: a` or `needs: [a, b]`, as a list. */
function needsOf(text, jobId) {
  const raw = jobField(text, jobId, "needs");
  if (raw === null) return [];
  const list = /^\[(.*)\]$/.exec(raw);
  return (list ? list[1].split(",") : [raw]).map((need) => need.trim());
}

test("release.yml has the jobs this file checks, and grants nothing by default", () => {
  assert.deepEqual([...jobsOf(release).keys()], RELEASE_JOBS);
  assert.match(release, /^permissions: \{\}$/m);
});

test("release.yml gives each job only the permissions it needs", () => {
  const expected = {
    verify: { contents: "read" },
    version: { contents: "write", "pull-requests": "write" },
    pack: { contents: "read" },
    publish: { contents: "read", "id-token": "write" },
    tag: { contents: "write" },
    "publish-dry-run": { contents: "read" },
  };
  for (const job of RELEASE_JOBS) {
    assert.deepEqual(permissionsOf(release, job), expected[job], `permissions of ${job}`);
  }
  // Nothing here dispatches a workflow. A workflow_dispatch run on the version
  // PR's branch would not give the PR its checks: GitHub does not count a
  // dispatched run's checks for a pull request (see the version job).
  assert.equal(grants(release, "actions"), 0, "no job may hold actions: write");
});

test("release.yml: only the publish job can publish, and only in the npm-publish environment", () => {
  for (const job of RELEASE_JOBS) {
    const environment = jobField(release, job, "environment");
    assert.equal(environment, job === "publish" ? "npm-publish" : null, `environment of ${job}`);
  }
  assert.equal(grants(release, "id-token"), 1, "id-token: write is granted once");

  for (const job of RELEASE_JOBS) {
    const scripts = stepsOf(release, job).map(runOf).filter(Boolean).join("\n");
    assert.doesNotMatch(
      scripts,
      /changeset publish|pnpm (?:publish|release)\b/,
      `${job} publishes`,
    );
    // The commands, not the log lines that name them.
    const publishes = scripts.split("\n").filter((line) => /^\s*npm publish\b/.test(line));
    if (job === "publish") {
      assert.equal(publishes.length, 1);
      assert.match(publishes[0], /--provenance --access public --tag latest --ignore-scripts/);
    } else if (job === "publish-dry-run") {
      assert.ok(publishes.length > 0 && publishes.every((line) => line.includes("--dry-run")));
    } else {
      assert.deepEqual(publishes, [], `${job} must not run npm publish`);
    }
  }
});

test("release.yml: the publish job checks out nothing, installs nothing and runs no repository code", () => {
  const steps = stepsOf(release, "publish");
  assert.deepEqual(
    steps
      .map(usesOf)
      .filter(Boolean)
      .map((uses) => uses.split("@")[0]),
    ["actions/download-artifact", "actions/setup-node"],
  );
  const scripts = steps.map(runOf).filter(Boolean).join("\n");
  assert.doesNotMatch(scripts, /\b(?:pnpm|yarn|npx|bun|corepack|turbo)\b/);
  assert.doesNotMatch(scripts, /\b(?:node|bash|sh) +(?:\.\/)?scripts\//);
  assert.doesNotMatch(scripts, /\bnode (?:-e|--eval|-p)\b/);
  // The one install is npm itself, pinned to a major: never npm@latest.
  const installs = scripts.split("\n").filter((line) => /\bnpm (?:install|i|ci)\b/.test(line));
  assert.deepEqual(installs, ["npm install -g npm@11"]);
  for (const step of steps) assert.doesNotMatch(step, /uses: \.\//);
});

test("release.yml: the dry run checks the tarballs with the very steps the publish job uses", () => {
  const shared = ["download-tarballs", "setup-node-for-npm", "npm-11", "check-tarballs"];
  const dryRun = rawStepsOf(jobsOf(release).get("publish-dry-run"));
  assert.deepEqual(
    dryRun.slice(0, shared.length).map((step) => /^ {6}- \*([\w-]+)$/.exec(step)?.[1]),
    shared,
  );
  const publish = rawStepsOf(jobsOf(release).get("publish"));
  assert.deepEqual(
    publish
      .slice(0, shared.length)
      .map((step) => /^ {6}- &([\w-]+)$/m.exec(step.split("\n")[0])?.[1]),
    shared,
  );
});

test("release.yml runs lint, typecheck, the tests and the package checks before anything is packed, versioned or published", () => {
  const steps = stepsOf(release, "verify");
  const position = (pattern) => {
    const found = steps.flatMap((step, index) => (pattern.test(step) ? [index] : []));
    assert.equal(found.length, 1, `expected exactly one verify step matching ${pattern}`);
    return found[0];
  };
  const firstAfterGates = position(/run: node scripts\/release-packages\.mjs state$/m);
  for (const command of [
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    // A core release must take the MCP server (which bundles core) with it.
    "node scripts/check-changesets.mjs",
    // The packed MCP server has to install and start, not only pass its tests.
    'bash scripts/smoke-mcp.sh "\\$RUNNER_TEMP/smoke-mcp"',
  ]) {
    const gate = position(new RegExp(`^ +run: ${command}$`, "m"));
    assert.ok(gate < firstAfterGates, `\`${command}\` must run before the release steps`);
    // A step that may fail or be skipped does not stop a red tree.
    assert.doesNotMatch(
      steps[gate],
      /^ +(continue-on-error|if):/m,
      `\`${command}\` must not be optional`,
    );
  }
  assert.equal(firstAfterGates, steps.length - 1, "state is the last step of verify");

  // Every other job waits for verify (directly or through pack or publish),
  // and none runs when verify failed: no status function such as always() or
  // !cancelled() in their conditions, which would let them run after a red
  // verify. The tag job may run after a failed publish, to tag what did reach
  // npm, but only through publish, which needs verify.
  assert.deepEqual(needsOf(release, "version"), ["verify"]);
  assert.deepEqual(needsOf(release, "pack"), ["verify"]);
  assert.deepEqual(needsOf(release, "publish"), ["verify", "pack"]);
  assert.deepEqual(needsOf(release, "publish-dry-run"), ["pack"]);
  assert.deepEqual(needsOf(release, "tag"), ["publish"]);
  for (const job of ["version", "pack", "publish", "publish-dry-run"]) {
    assert.doesNotMatch(jobField(release, job, "if"), /always\(\)|cancelled\(\)|failure\(\)/, job);
  }
  assert.match(jobField(release, "publish", "if"), /needs\.verify\.outputs\.pending == 'false'/);
  assert.match(jobField(release, "publish", "if"), /needs\.pack\.outputs\.unpublished != '0'/);
  assert.match(jobField(release, "publish", "if"), /!inputs\.dry_run/);
  assert.match(jobField(release, "publish", "if"), /github\.ref == 'refs\/heads\/main'/);
  assert.match(jobField(release, "pack", "if"), /needs\.verify\.outputs\.pending == 'false'/);
  assert.match(jobField(release, "pack", "if"), /github\.ref == 'refs\/heads\/main'/);
  assert.match(jobField(release, "version", "if"), /needs\.verify\.outputs\.pending == 'true'/);
  assert.match(jobField(release, "version", "if"), /github\.ref == 'refs\/heads\/main'/);
});

test("release.yml packs the tarballs on a runner of their own that runs nothing but the build", () => {
  const steps = stepsOf(release, "pack");
  assert.deepEqual(
    steps
      .map(usesOf)
      .filter(Boolean)
      .map((uses) => uses.split("@")[0]),
    ["actions/checkout", "pnpm/action-setup", "actions/setup-node", "actions/upload-artifact"],
  );
  // No lint, no tests, no smoke test, no install script: the build and the pack.
  assert.deepEqual(steps.map(runOf).filter(Boolean), [
    "pnpm install --frozen-lockfile --ignore-scripts",
    "pnpm exec turbo run build --filter='./packages/*'",
    'node scripts/release-packages.mjs pack "$RUNNER_TEMP/release"',
  ]);
  assert.match(
    steps.find((step) => usesOf(step)?.startsWith("actions/checkout@")),
    /^ +persist-credentials: false$/m,
  );

  // Only pack uploads tarballs: what verify ran never reaches the artifact.
  const uploaders = RELEASE_JOBS.filter((job) =>
    stepsOf(release, job).some((step) => usesOf(step)?.startsWith("actions/upload-artifact@")),
  );
  assert.deepEqual(uploaders, ["pack"]);
  assert.doesNotMatch(
    stepsOf(release, "verify").join("\n"),
    /release-packages\.mjs pack|turbo run build/,
    "verify must not build or pack what is published",
  );

  // No dependency cache anywhere: a restored cache would run in the gates and
  // be built into the tarballs. GitHub enforces it (cache-mode: none), and no
  // step asks for one.
  assert.match(release, /^cache-mode: none$/m);
  assert.doesNotMatch(release, /uses: actions\/cache[/@]/);
  for (const job of RELEASE_JOBS) {
    for (const step of stepsOf(release, job).filter((s) =>
      usesOf(s)?.startsWith("actions/setup-node@"),
    )) {
      assert.match(step, /^ +package-manager-cache: false$/m, `${job}: setup-node caches`);
      assert.doesNotMatch(step, /^ +cache:/m, `${job}: setup-node caches`);
    }
  }
});

test("release.yml: changesets/action only versions", () => {
  const users = RELEASE_JOBS.filter((job) =>
    stepsOf(release, job).some((step) => usesOf(step)?.startsWith("changesets/action@")),
  );
  assert.deepEqual(users, ["version"]);
  const action = stepsOf(release, "version").find((step) =>
    usesOf(step)?.startsWith("changesets/action@"),
  );
  // changesets/action v2 input names: the v1 names (version, publish) are ignored.
  assert.match(action, /^ +version-script: pnpm version-packages$/m);
  // Set only for the PR's wording; it can never run, and fails if it does.
  assert.match(action, /^ +publish-script: node -e ".*process\.exit\(1\)"$/m);
  assert.doesNotMatch(action, /^ +(?:version|publish|commit|title): /m);
  assert.match(
    stepsOf(release, "version").find((step) => /pnpm install/.test(step)),
    /run: pnpm install --frozen-lockfile --ignore-scripts$/m,
  );
});

test("release.yml and e2e-fuji.yml: every job has a timeout, every action is pinned to a commit", () => {
  for (const [file, text] of [
    ["release.yml", release],
    ["e2e-fuji.yml", e2e],
  ]) {
    for (const job of jobsOf(text).keys()) {
      assert.match(
        jobField(text, job, "timeout-minutes") ?? "",
        /^\d+$/,
        `${file}: ${job} has no timeout`,
      );
    }
    for (const uses of usesLines(text)) {
      assert.match(
        uses,
        /^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+(?:\.\d+){0,2}$/,
        `${file}: ${uses}`,
      );
    }
  }
});

// ── e2e-fuji.yml ─────────────────────────────────────────────────────────────

test("e2e-fuji.yml: only the report job writes to issues, after the legs, whatever they did", () => {
  assert.deepEqual([...jobsOf(e2e).keys()], ["e2e", "report"]);
  assert.match(e2e, /^permissions:\n {2}contents: read$/m);
  assert.equal(permissionsOf(e2e, "e2e"), null, "the legs keep the read-only default");
  assert.deepEqual(permissionsOf(e2e, "report"), {
    contents: "read",
    actions: "read",
    issues: "write",
  });
  assert.equal(grants(e2e, "issues"), 1);
  assert.equal(jobField(e2e, "report", "needs"), "e2e");
  const condition = jobField(e2e, "report", "if");
  assert.match(condition, /!cancelled\(\)/);
  assert.match(condition, /needs\.e2e\.result != 'skipped'/);
  assert.match(condition, /github\.repository == 'mericcintosun\/AvaKit'/);
  const run = stepsOf(e2e, "report").find((step) => runOf(step));
  assert.equal(runOf(run), "node scripts/e2e-fuji-report.mjs");
  assert.match(run, /^ +RESULT: \$\{\{ needs\.e2e\.result \}\}$/m);
  assert.match(run, /^ +GH_TOKEN: \$\{\{ github\.token \}\}$/m);
});

test("e2e-fuji.yml names its legs and their summaries the way the report reads them", () => {
  assert.match(
    jobsOf(e2e).get("e2e"),
    /^ {4}name: \$\{\{ matrix\.os \}\} · Node \$\{\{ matrix\.node \}\} · /m,
  );
  assert.match(
    jobsOf(e2e).get("e2e"),
    new RegExp(
      `^ +name: ${ARTIFACT_PREFIX}\\$\\{\\{ matrix\\.os \\}\\}-node\\$\\{\\{ matrix\\.node \\}\\}$`,
      "m",
    ),
  );
  // The same leg, as GitHub names its job and its artifact.
  assert.equal(legKey("windows-latest · Node 24 · up to the build"), "windows-latest-node24");
});

// ── release.yml's publish steps, run ─────────────────────────────────────────
//
// The check, publish and record steps of the publish job (and the dry run's
// last step) are shell scripts that run with bash, GNU coreutils and find, jq,
// tar, curl and npm on ubuntu-latest. These tests run them as they are written
// in release.yml, against tarballs packed here, with `curl` and `npm` replaced
// by stand-ins that answer from a table and record what they were asked. They
// need what ubuntu-latest has (bash 4 or newer, GNU find and sha256sum, jq)
// and are skipped elsewhere, as on a stock macOS.

const SHELL_TOOLS_MISSING = (() => {
  const probe = spawnSync(
    "bash",
    [
      "-c",
      "mapfile -t x < /dev/null && find . -maxdepth 0 -printf '' && sha256sum --check --strict --version > /dev/null && jq --version > /dev/null && tar --version > /dev/null",
    ],
    { encoding: "utf8" },
  );
  return probe.status === 0 ? false : "needs bash >= 4, GNU find and coreutils, jq and tar";
})();

const publishSteps = stepsOf(release, "publish");
const stepNamed = (steps, name) => {
  const step = steps.find((candidate) => nameOf(candidate) === name);
  assert.ok(step, `no step named ${name}`);
  return step;
};
const CHECK = runOf(stepNamed(publishSteps, "Check the tarballs"));
const PUBLISH = runOf(stepNamed(publishSteps, "Publish"));
const RECORD = runOf(stepNamed(publishSteps, "Record what was released"));
const DRY_RUN = runOf(stepNamed(stepsOf(release, "publish-dry-run"), "npm publish --dry-run"));
const PUBLISHABLE = /^ +PUBLISHABLE: "([^"]+)"$/m.exec(
  stepNamed(publishSteps, "Check the tarballs"),
)[1];

/**
 * A runner's temp directory with an artifact in `release/`: one tarball per
 * package (`{ name, version, published, packed }`, where `packed` overrides
 * the package.json inside it), manifest.json and SHA256SUMS; and stand-ins
 * for curl (answering `registry`, `{ "name@version": status }`, 404 otherwise)
 * and npm (failing for the tarball named `npmFails`).
 */
function fixture(t, packages, { registry = {}, npmFails = "" } = {}) {
  const temp = mkdtempSync(join(tmpdir(), "avakit-release-wf-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const dir = join(temp, "release");
  const bin = join(temp, "bin");
  mkdirSync(dir);
  mkdirSync(bin);
  const entries = packages.map(({ name, version, published = false, packed = {} }) => {
    const file = `${name.replace("@", "").replace("/", "-")}-${version}.tgz`;
    const src = join(temp, "src", file, "package");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "package.json"), JSON.stringify({ name, version, ...packed }));
    const made = spawnSync("tar", ["-czf", join(dir, file), "-C", join(src, ".."), "package"]);
    assert.equal(made.status, 0, String(made.stderr));
    const sha256 = createHash("sha256")
      .update(readFileSync(join(dir, file)))
      .digest("hex");
    return { name, version, file, sha256, integrity: "sha512-x", published };
  });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ packages: entries }, null, 2));
  writeFileSync(join(dir, "SHA256SUMS"), entries.map((e) => `${e.sha256}  ${e.file}\n`).join(""));

  const table = Object.entries(registry)
    .map(([spec, status]) => {
      const at = spec.lastIndexOf("@");
      return `https://registry.npmjs.org/${spec.slice(0, at).replace("/", "%2F")}/${spec.slice(at + 1)} ${status}\n`;
    })
    .join("");
  writeFileSync(join(temp, "registry.txt"), table);
  writeFileSync(
    join(bin, "curl"),
    `#!/usr/bin/env bash\nurl="\${@: -1}"\nstatus="$(awk -v u="$url" '$1 == u { print $2 }' "${join(temp, "registry.txt")}")"\nprintf '%s' "\${status:-404}"\n`,
  );
  writeFileSync(
    join(bin, "npm"),
    `#!/usr/bin/env bash\necho "npm $*" >> "${join(temp, "npm.log")}"\n` +
      (npmFails ? `case "$*" in *"${npmFails}"*) echo "npm error E403" >&2; exit 1 ;; esac\n` : ""),
  );
  chmodSync(join(bin, "curl"), 0o755);
  chmodSync(join(bin, "npm"), 0o755);
  writeFileSync(join(temp, "output"), "");
  writeFileSync(join(temp, "summary"), "");

  /** Run one step's script the way Actions runs a bash step. */
  const run = (script) =>
    spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: temp,
        PUBLISHABLE,
        GITHUB_OUTPUT: join(temp, "output"),
        GITHUB_STEP_SUMMARY: join(temp, "summary"),
      },
    });
  const text = (name) => {
    try {
      return readFileSync(join(temp, name), "utf8");
    } catch {
      return "";
    }
  };
  return { dir, run, text };
}

const CORE = { name: "@avakit/core", version: "0.3.0" };
const REACT = {
  name: "@avakit/react",
  version: "0.3.0",
  packed: { dependencies: { "@avakit/core": "0.3.0" } },
};

test("publish job: checks the tarballs, publishes what npm lacks with provenance, and reports it", {
  skip: SHELL_TOOLS_MISSING,
}, (t) => {
  const f = fixture(t, [
    CORE,
    REACT,
    { name: "create-avalanche-app", version: "0.4.3", published: true },
  ]);
  const check = f.run(CHECK);
  assert.equal(check.status, 0, check.stderr + check.stdout);
  assert.equal(
    f.text("to-publish.tsv"),
    "@avakit/core\t0.3.0\tavakit-core-0.3.0.tgz\n@avakit/react\t0.3.0\tavakit-react-0.3.0.tgz\n",
  );
  const publish = f.run(PUBLISH);
  assert.equal(publish.status, 0, publish.stderr);
  assert.equal(
    f.text("npm.log"),
    [
      "npm publish ./avakit-core-0.3.0.tgz --provenance --access public --tag latest --ignore-scripts",
      "npm publish ./avakit-react-0.3.0.tgz --provenance --access public --tag latest --ignore-scripts",
      "",
    ].join("\n"),
  );
  const record = f.run(RECORD);
  assert.equal(record.status, 0, record.stderr);
  assert.equal(f.text("output"), 'released=["@avakit/core@0.3.0","@avakit/react@0.3.0"]\n');
  assert.match(f.text("summary"), /- published: @avakit\/core@0\.3\.0/);
});

test("publish job: what npm has by the time of the approval is skipped, and still tagged", {
  skip: SHELL_TOOLS_MISSING,
}, (t) => {
  const f = fixture(t, [CORE], { registry: { "@avakit/core@0.3.0": 200 } });
  assert.equal(f.run(CHECK).status, 0);
  assert.equal(f.text("to-publish.tsv"), "");
  const publish = f.run(PUBLISH);
  assert.equal(publish.status, 0);
  assert.match(publish.stdout, /Nothing left to publish/);
  assert.equal(f.text("npm.log"), "");
  f.run(RECORD);
  assert.equal(f.text("output"), 'released=["@avakit/core@0.3.0"]\n');
});

test("publish job: the first failed publish stops the job, and only what reached npm is reported", {
  skip: SHELL_TOOLS_MISSING,
}, (t) => {
  const f = fixture(t, [CORE, REACT], { npmFails: "avakit-core-0.3.0.tgz" });
  assert.equal(f.run(CHECK).status, 0);
  const publish = f.run(PUBLISH);
  assert.notEqual(publish.status, 0);
  // react depends on the core that failed, so it is not published after it.
  assert.equal(f.text("npm.log").trim().split("\n").length, 1);
  f.run(RECORD);
  assert.equal(f.text("output"), "released=[]\n");
});

test("publish job: nothing is published from an artifact that is not exactly what pack packed", {
  skip: SHELL_TOOLS_MISSING,
}, async (t) => {
  const cases = [
    [
      "a tarball changed after it was summed",
      [CORE],
      (f) => writeFileSync(join(f.dir, "avakit-core-0.3.0.tgz"), "changed"),
      /FAILED|did NOT match/,
    ],
    [
      "a tarball the manifest does not list",
      [CORE],
      (f) => writeFileSync(join(f.dir, "extra-1.0.0.tgz"), ""),
      /exactly the tarballs/,
    ],
    [
      "a package this workflow does not publish",
      [{ name: "left-pad", version: "1.0.0" }],
      () => {},
      /left-pad, which this workflow does not publish/,
    ],
    [
      "a tarball of another version",
      [{ ...CORE, packed: { version: "0.2.9" } }],
      () => {},
      /is not @avakit\/core@0\.3\.0/,
    ],
    [
      "a range left for the workspace",
      [{ ...REACT, packed: { dependencies: { "@avakit/core": "workspace:*" } } }],
      () => {},
      /workspace-only ranges: @avakit\/core workspace:\*/,
    ],
    [
      "a registry that cannot say",
      [CORE],
      () => {},
      /answered HTTP 503/,
      { registry: { "@avakit/core@0.3.0": 503 } },
    ],
  ];
  for (const [label, packages, spoil, error, options] of cases) {
    await t.test(label, (tt) => {
      const f = fixture(tt, packages, options);
      spoil(f);
      const check = f.run(CHECK);
      assert.notEqual(check.status, 0, label);
      assert.match(check.stdout + check.stderr, error, label);
      // Whatever the publish step would have read is empty or absent.
      assert.equal(f.text("to-publish.tsv"), "", label);
    });
  }
});

test("publish dry run: npm publish --dry-run for each tarball npm lacks, and a notice when there is none", {
  skip: SHELL_TOOLS_MISSING,
}, (t) => {
  const f = fixture(t, [CORE]);
  assert.equal(f.run(CHECK).status, 0);
  const dry = f.run(DRY_RUN);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(
    f.text("npm.log"),
    "npm publish ./avakit-core-0.3.0.tgz --dry-run --access public --tag latest --ignore-scripts\n",
  );

  const none = fixture(t, [{ ...CORE, published: true }]);
  assert.equal(none.run(CHECK).status, 0);
  const notice = none.run(DRY_RUN);
  assert.equal(notice.status, 0);
  assert.match(notice.stdout, /::notice title=Release dry run::npm has every version/);
  assert.equal(none.text("npm.log"), "");
});

// ---------------------------------------------------------------------------
// .github/workflows/ci.yml
//
// The main branch ruleset requires one check, the "CI passed" job, so that job
// must wait for every other job, must not be skippable, and must fail unless
// each of them succeeded. The other rules every job in the file follows are
// checked here too: a read-only token, a timeout, actions pinned to a commit,
// no persisted git credentials, no path filter that could leave a pull request
// waiting for a check that never runs. Read as text, like release.yml above.

const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8").replace(
  /\r\n/g,
  "\n",
);

/** The text of each job in ci.yml by job id, from its `  <id>:` line to the next job's. */
function ciJobsOf(text) {
  const start = text.search(/^jobs:\n/m);
  assert.notEqual(start, -1, "ci.yml has no top-level `jobs:` key");
  const rest = text.slice(start + "jobs:\n".length);
  const next = rest.search(/^\S/m);
  const body = next === -1 ? rest : rest.slice(0, next);
  const heads = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):\n/gm)];
  return new Map(
    heads.map((head, i) => [head[1], body.slice(head.index, heads[i + 1]?.index ?? body.length)]),
  );
}

const ciJobs = ciJobsOf(ci);

/** A job's text, failing the test when ci.yml has no job with that id. */
function ciJob(id) {
  const job = ciJobs.get(id);
  assert.ok(job, `ci.yml has no \`${id}\` job`);
  return job;
}

/** The steps of a job, each as the text from its `- ` line to the next step's. */
function ciStepsOf(job) {
  return job.split(/^(?= {6}- )/m).slice(1);
}

/** The engines.node of a package.json, relative to the repository root. */
function enginesNode(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8")).engines?.node;
}

test("ci.yml runs on every push and pull request to main, by hand, and on every path", () => {
  const on = ci.match(/^on:\n((?: .*\n|\n)*)/m)?.[1];
  assert.ok(on, "ci.yml has no `on:` block");
  for (const trigger of ["push", "pull_request", "workflow_dispatch"]) {
    assert.match(on, new RegExp(`^ {2}${trigger}:`, "m"), `ci.yml must run on ${trigger}`);
  }
  // A required check whose run never starts keeps a pull request waiting forever.
  assert.doesNotMatch(ci, /^\s*paths(-ignore)?:/m, "no trigger in ci.yml may be path-filtered");
  // So would a narrower pull_request trigger: `types: [opened]` starts no run
  // for the pull request's next push, another branch none for its first.
  assert.match(
    on,
    /^ {2}pull_request:\n {4}branches: \[main\]\n(?! {4})/m,
    "the pull_request trigger must be exactly `branches: [main]`",
  );
});

/** ci.yml without its comment lines, for the checks a comment could trip. */
const ciCode = ci
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

test("ci.yml gives its token read access only", () => {
  assert.match(
    ci,
    /^permissions:\n {2}contents: read\n(?! )/m,
    "ci.yml must set `permissions: contents: read` at the top level, and nothing else there",
  );
  assert.doesNotMatch(ci, /^\s+[a-z-]+: write\s*$/m, "no job in ci.yml may ask for write access");
  // Nor in flow style (`permissions: { contents: write }`), nor through the
  // shorthands (`permissions: write-all`, `permissions: read-all`).
  assert.doesNotMatch(ciCode, /:\s*write\b/, "no job in ci.yml may ask for write access");
  assert.doesNotMatch(
    ciCode,
    /\b(read|write)-all\b/,
    "no job in ci.yml may use read-all or write-all",
  );
});

test("no job or step in ci.yml can fail without failing the run", () => {
  assert.doesNotMatch(
    ciCode,
    /continue-on-error/,
    "no job or step in ci.yml may continue on error",
  );
  // A step's `if:` can skip a check while its job still succeeds. The one kind
  // allowed runs a step even after an earlier step failed.
  for (const [, condition] of ciCode.matchAll(/^ {8}if: (.+)$/gm)) {
    assert.match(
      condition,
      /^\$\{\{ !cancelled\(\) \}\}\s*$/,
      `a step in ci.yml may only be conditional on !cancelled(), not ${condition.trim()}`,
    );
  }
});

test("every job in ci.yml has a timeout", () => {
  for (const [id, job] of ciJobs) {
    assert.match(job, /^ {4}timeout-minutes: \d+\s*$/m, `job \`${id}\` has no timeout-minutes`);
  }
});

test("every action in ci.yml is pinned to a commit, and no checkout keeps its credentials", () => {
  const uses = [...ci.matchAll(/^\s+(?:- )?uses: (.+)$/gm)].map((match) => match[1].trim());
  assert.ok(uses.length > 0, "ci.yml uses no actions");
  for (const action of uses) {
    assert.match(
      action,
      /^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\S+$/,
      `\`${action}\` must be pinned to a full commit SHA, with its version in a comment`,
    );
  }
  for (const [id, job] of ciJobs) {
    for (const step of ciStepsOf(job).filter((s) => /uses: actions\/checkout@/.test(s))) {
      assert.match(
        step,
        /^\s+persist-credentials: false\s*$/m,
        `the checkout in job \`${id}\` must set persist-credentials: false`,
      );
    }
  }
});

test("the verify job runs on the Node.js floor every package declares, and on Node.js 24", () => {
  const verify = ciJob("verify");
  assert.match(
    verify,
    /^ {4}name: .*\$\{\{ matrix\.node \}\}/m,
    "verify's name must say its Node.js",
  );
  const list = verify.match(/^ {8}node: \[([^\]]+)\]\s*$/m)?.[1];
  assert.ok(list, "verify's matrix must be written as `node: [<major>, ...]`");
  const nodes = list.split(",").map((n) => Number(n.trim()));
  assert.ok(nodes.includes(24), "verify must run on Node.js 24, the line in .nvmrc");
  const oldest = Math.min(...nodes);

  // Every published package declares the oldest line verify runs on. The root
  // may ask for a later release of that same line (the website's tests import
  // .ts files, which Node.js 22 runs without a flag from 22.18.0 on); verify
  // installs the newest release of each line, so it still meets that.
  const root = enginesNode("package.json");
  assert.equal(
    Number(root?.match(/^>=(\d+)(?:\.\d+){0,2}$/)?.[1]),
    oldest,
    `root engines.node (${root}) must be on the oldest line verify runs on, Node.js ${oldest}`,
  );
  for (const name of ["core", "react", "mcp", "studio", "create-avalanche-app"]) {
    assert.equal(
      enginesNode(join("packages", name, "package.json")),
      `>=${oldest}`,
      `packages/${name} must declare engines.node >=${oldest}, the oldest line verify runs on`,
    );
  }
});

test("ci.yml fails on a high or critical advisory, in the lockfiles and in a pull request", () => {
  const audit = ciStepsOf(ciJob("audit"));
  assert.ok(
    audit.some((step) => /^\s+run: pnpm audit --audit-level=high\s*$/m.test(step)),
    "the audit job must run `pnpm audit --audit-level=high`",
  );
  for (const service of ["faucet", "telemetry"]) {
    assert.ok(
      audit.some(
        (step) =>
          new RegExp(`^\\s+working-directory: services/${service}\\s*$`, "m").test(step) &&
          /^\s+run: npm audit --audit-level=high\s*$/m.test(step),
      ),
      `the audit job must run \`npm audit --audit-level=high\` in services/${service}`,
    );
  }

  const review = ciJob("dependency-review");
  assert.match(review, /^ {4}if: github\.event_name == 'pull_request'\s*$/m);
  assert.match(review, /uses: actions\/dependency-review-action@/);
  assert.match(review, /^\s+fail-on-severity: high\s*$/m);
  // The action's default is runtime only, and the dependency graph scopes
  // devDependencies and the Workers' wrangler trees as development.
  assert.match(
    review,
    /^\s+fail-on-scopes: runtime, development, unknown\s*$/m,
    "the review must fail on an advisory in any scope",
  );
});

test('"CI passed" waits for every other job in ci.yml and cannot be skipped', () => {
  const gate = ciJob("ci-passed");
  assert.match(gate, /^ {4}name: CI passed\s*$/m, "the ruleset requires the check by this name");
  assert.match(gate, /^ {4}if: always\(\)\s*$/m, "a skipped required check would count as passed");

  const needs = gate
    .match(/^ {4}needs:\n((?: {6}- .*\n)+)/m)?.[1]
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace(/^ {6}- /, "").trim());
  assert.ok(needs, "`ci-passed` must list its needs one per line");
  const others = [...ciJobs.keys()].filter((id) => id !== "ci-passed").sort();
  assert.deepEqual(
    [...needs].sort(),
    others,
    "`ci-passed` must need every other job in ci.yml, each once",
  );

  // A job that is skipped on some event fails "CI passed" on that event, unless
  // the gate lets it be skipped. Only dependency-review (pull requests only) may.
  for (const [id, job] of ciJobs) {
    if (id === "ci-passed" || id === "dependency-review") continue;
    assert.doesNotMatch(job, /^ {4}if:/m, `job \`${id}\` must not be conditional`);
  }
  assert.match(
    gate,
    /MAY_SKIP: \$\{\{ github\.event_name != 'pull_request' && 'dependency-review' \|\| '' \}\}/,
  );
});

/** The `run: |` script of the "CI passed" job's step, dedented. */
function gateScript() {
  const lines = ciJob("ci-passed").split("\n");
  const start = lines.findIndex((line) => /^ {8}run: \|\s*$/.test(line));
  assert.notEqual(start, -1, "the `ci-passed` step must have a `run: |` script");
  const script = [];
  for (const line of lines.slice(start + 1)) {
    if (line !== "" && !line.startsWith(" ".repeat(10))) break;
    script.push(line.slice(10));
  }
  return script.join("\n");
}

const hasTools = ["bash", "jq"].every(
  (tool) => spawnSync(tool, ["--version"], { stdio: "ignore" }).status === 0,
);

test('the "CI passed" step fails unless every job succeeded', {
  skip: hasTools ? false : "needs bash and jq on PATH",
}, () => {
  const script = gateScript();
  const ids = [...ciJobs.keys()].filter((id) => id !== "ci-passed");
  const needs = (results = {}) =>
    JSON.stringify(Object.fromEntries(ids.map((id) => [id, { result: results[id] ?? "success" }])));
  /** Whether the step passes for these job results on this event. */
  const passes = (event, results) =>
    spawnSync("bash", ["-e", "-c", script], {
      env: {
        ...process.env,
        NEEDS: typeof results === "string" ? results : needs(results),
        MAY_SKIP: event === "pull_request" ? "" : "dependency-review",
      },
      stdio: "ignore",
    }).status === 0;

  assert.ok(passes("pull_request", {}), "every job succeeded on a pull request");
  assert.ok(passes("push", {}), "every job succeeded on a push");
  assert.ok(passes("push", { "dependency-review": "skipped" }), "a push skips the review");
  assert.ok(passes("workflow_dispatch", { "dependency-review": "skipped" }));

  assert.ok(!passes("pull_request", { "dependency-review": "skipped" }));
  assert.ok(!passes("pull_request", { verify: "failure" }));
  assert.ok(!passes("push", { verify: "skipped" }));
  assert.ok(!passes("push", { "smoke-templates": "cancelled" }));
  assert.ok(!passes("push", "not json"), "unreadable results fail closed");
});
