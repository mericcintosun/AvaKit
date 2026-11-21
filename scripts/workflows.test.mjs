// A tripwire for the one property of .github/workflows/release.yml that must
// not be lost quietly: nothing is versioned or published before lint,
// typecheck, the tests, the changeset check and the MCP install smoke test
// have passed in the same job.
//
// The file is read as text, not parsed — the repo has no YAML dependency, and
// the release job is a flat list of named steps. If you restructure the
// workflow, keep the guarantee and update this test with it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Line endings are normalised so a checkout with CRLF reads the same.
const release = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8").replace(
  /\r\n/g,
  "\n",
);

/** The workflow's steps in order, each as the text from its `- name:` line to the next one. */
const steps = release.split(/^(?= +- name:)/m).slice(1);

/** Position of the only step with a line matching `pattern`. */
function stepWith(pattern) {
  const found = steps.flatMap((step, index) => (pattern.test(step) ? [index] : []));
  assert.equal(found.length, 1, `expected exactly one step matching ${pattern} in release.yml`);
  return found[0];
}

test("release.yml runs lint, typecheck, the tests and the package checks before changesets/action", () => {
  const publish = stepWith(/^ +uses: changesets\/action@/m);

  for (const command of [
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    // A core release must take the MCP server (which bundles core) with it.
    "node scripts/check-changesets.mjs",
    // The packed MCP server has to install and start, not only pass its tests.
    'bash scripts/smoke-mcp.sh "\\$RUNNER_TEMP/smoke-mcp"',
  ]) {
    const gate = stepWith(new RegExp(`^ +run: ${command}$`, "m"));
    assert.ok(gate < publish, `\`${command}\` must run before the changesets/action step`);
    // A step that may fail or be skipped does not stop a red tree.
    assert.doesNotMatch(
      steps[gate],
      /^ +(continue-on-error|if):/m,
      `the \`${command}\` step must not be optional`,
    );
  }
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

import { spawnSync } from "node:child_process";

const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8").replace(
  /\r\n/g,
  "\n",
);

/** The text of each job in ci.yml by job id, from its `  <id>:` line to the next job's. */
function jobsOf(text) {
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

const ciJobs = jobsOf(ci);

/** A job's text, failing the test when ci.yml has no job with that id. */
function ciJob(id) {
  const job = ciJobs.get(id);
  assert.ok(job, `ci.yml has no \`${id}\` job`);
  return job;
}

/** The steps of a job, each as the text from its `- ` line to the next step's. */
function stepsOf(job) {
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
});

test("ci.yml gives its token read access only", () => {
  assert.match(
    ci,
    /^permissions:\n {2}contents: read\n(?! )/m,
    "ci.yml must set `permissions: contents: read` at the top level, and nothing else there",
  );
  assert.doesNotMatch(ci, /^\s+[a-z-]+: write\s*$/m, "no job in ci.yml may ask for write access");
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
    for (const step of stepsOf(job).filter((s) => /uses: actions\/checkout@/.test(s))) {
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
  const audit = stepsOf(ciJob("audit"));
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
