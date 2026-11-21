// Tripwires for the properties of the workflow files that must not be lost
// quietly.
//
// release.yml: nothing is versioned or published before lint, typecheck, the
// tests, the changeset check and the MCP install smoke test have passed; each
// job holds only the permissions it needs; the one job that can publish runs
// in the npm-publish environment, checks out nothing, installs nothing and
// runs no code of this repository; and its shell steps do what they say,
// which the last tests check by running them against fixture tarballs.
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

const RELEASE_JOBS = ["verify", "version", "version-ci", "publish", "tag", "publish-dry-run"];

test("release.yml has the jobs this file checks, and grants nothing by default", () => {
  assert.deepEqual([...jobsOf(release).keys()], RELEASE_JOBS);
  assert.match(release, /^permissions: \{\}$/m);
});

test("release.yml gives each job only the permissions it needs", () => {
  const expected = {
    verify: { contents: "read" },
    version: { contents: "write", "pull-requests": "write" },
    "version-ci": { actions: "write", contents: "read" },
    publish: { contents: "read", "id-token": "write" },
    tag: { contents: "write" },
    "publish-dry-run": { contents: "read" },
  };
  for (const job of RELEASE_JOBS) {
    assert.deepEqual(permissionsOf(release, job), expected[job], `permissions of ${job}`);
  }
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
  assert.ok(position(/release-packages\.mjs pack/) > firstAfterGates);

  // Every job that versions, publishes or tags waits for verify (directly or
  // through publish), and none runs when verify failed: no status function
  // such as always() or !cancelled() in their conditions, which would let them
  // run after a red verify. The tag job may run after a failed publish, to tag
  // what did reach npm, but only through publish, which needs verify.
  assert.equal(jobField(release, "version", "needs"), "verify");
  assert.equal(jobField(release, "publish", "needs"), "verify");
  assert.equal(jobField(release, "publish-dry-run", "needs"), "verify");
  assert.equal(jobField(release, "version-ci", "needs"), "version");
  assert.equal(jobField(release, "tag", "needs"), "publish");
  for (const job of ["version", "version-ci", "publish", "publish-dry-run"]) {
    assert.doesNotMatch(jobField(release, job, "if"), /always\(\)|cancelled\(\)|failure\(\)/, job);
  }
  assert.match(jobField(release, "publish", "if"), /needs\.verify\.outputs\.pending == 'false'/);
  assert.match(jobField(release, "publish", "if"), /!inputs\.dry_run/);
  assert.match(jobField(release, "publish", "if"), /github\.ref == 'refs\/heads\/main'/);
  assert.match(jobField(release, "version", "if"), /needs\.verify\.outputs\.pending == 'true'/);
  assert.match(jobField(release, "version", "if"), /github\.ref == 'refs\/heads\/main'/);
});

test("release.yml: changesets/action only versions, and the version PR's CI is started with GITHUB_TOKEN", () => {
  const users = RELEASE_JOBS.filter((job) =>
    stepsOf(release, job).some((step) => usesOf(step)?.startsWith("changesets/action@")),
  );
  assert.deepEqual(users, ["version"]);
  const action = stepsOf(release, "version").find((step) =>
    usesOf(step)?.startsWith("changesets/action@"),
  );
  assert.match(action, /^ +version: pnpm version-packages$/m);
  // Set only for the PR's wording; it can never run, and fails if it does.
  assert.match(action, /^ +publish: node -e ".*process\.exit\(1\)"$/m);
  assert.match(
    stepsOf(release, "version").find((step) => /pnpm install/.test(step)),
    /run: pnpm install --frozen-lockfile --ignore-scripts$/m,
  );

  const [dispatch] = stepsOf(release, "version-ci");
  assert.match(
    runOf(dispatch),
    /^gh workflow run ci\.yml --repo "\$GITHUB_REPOSITORY" --ref "\$BRANCH"$/m,
  );
  assert.match(dispatch, /^ +BRANCH: changeset-release\/\$\{\{ github\.ref_name \}\}$/m);
  assert.match(dispatch, /^ +GH_TOKEN: \$\{\{ github\.token \}\}$/m);
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

test("publish job: nothing is published from an artifact that is not exactly what verify packed", {
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
