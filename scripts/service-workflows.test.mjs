// A tripwire for the properties of .github/workflows/deploy-workers.yml and
// .github/workflows/monitor.yml that must not be lost quietly: the Cloudflare
// token is only ever handed to the step that deploys, in the approval-gated
// environment, after the tests; every action is pinned to a commit; every job
// has a time limit and only the permissions it needs.
//
// The files are read as text, not parsed (the repo has no YAML dependency).
// If you restructure a workflow, keep the guarantee and update this test.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) =>
  readFileSync(join(root, ".github", "workflows", name), "utf8").replace(/\r\n/g, "\n");

/** The text of each job, by id: from its `  id:` line to the next one. */
function jobs(text) {
  const body = text.slice(text.indexOf("\njobs:\n") + "\njobs:\n".length);
  return Object.fromEntries(
    body
      .split(/^(?= {2}[\w-]+:$)/m)
      .filter(Boolean)
      .map((job) => [job.match(/^ {2}([\w-]+):$/m)[1], job]),
  );
}

/** A job's steps in order, each from its `- name:` line to the next one. */
const steps = (job) => job.split(/^(?= +- name:)/m).slice(1);

/** Position of the only step whose text matches `pattern`. */
function stepWith(list, pattern) {
  const found = list.flatMap((step, index) => (pattern.test(step) ? [index] : []));
  assert.equal(found.length, 1, `expected exactly one step matching ${pattern}`);
  return found[0];
}

function pinnedAndLimited(text) {
  const uses = [...text.matchAll(/^\s+(?:- )?uses: (\S+)(.*)$/gm)];
  assert.ok(uses.length > 0);
  for (const [, action, comment] of uses) {
    assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${action} is not pinned to a commit`);
    assert.match(comment, /^ # v\d/, `${action} has no version comment`);
  }
  // Nothing at the top: each job asks for what it needs.
  assert.match(text, /^permissions: \{\}$/m);
  for (const [id, job] of Object.entries(jobs(text))) {
    assert.match(job, /^ {4}timeout-minutes: \d+$/m, `job ${id} has no timeout-minutes`);
    assert.match(job, /^ {4}permissions:$/m, `job ${id} does not name its permissions`);
  }
}

describe("deploy-workers.yml", () => {
  const text = read("deploy-workers.yml");
  const { plan, deploy } = jobs(text);
  const deploySteps = steps(deploy);

  it("pins every action, limits every job in time and grants nothing by default", () => {
    pinnedAndLimited(text);
  });

  it("deploys in the approval-gated environment, with read-only repository access", () => {
    assert.match(deploy, /^ {4}environment:\n {6}name: cloudflare-workers$/m);
    assert.match(deploy, /^ {4}permissions:\n {6}contents: read\n(?! {6})/m);
    assert.match(plan, /^ {4}permissions:\n {6}contents: read\n(?! {6})/m);
    // A fork has neither the environment nor the account.
    assert.match(plan, /^ {4}if: github\.repository == 'mericcintosun\/AvaKit'$/m);
    assert.match(deploy, /^ {4}if: github\.repository == 'mericcintosun\/AvaKit' && /m);
  });

  it("hands the Cloudflare token to the credential check and the deploy step only", () => {
    const holders = deploySteps
      .map((step, index) => (/secrets\.CLOUDFLARE_API_TOKEN/.test(step) ? index : -1))
      .filter((index) => index >= 0);
    assert.deepEqual(holders, [
      stepWith(deploySteps, /- name: Check the Cloudflare credentials$/m),
      stepWith(deploySteps, /- name: Deploy$/m),
    ]);
    // Not in a job-level env, where every step (and every dependency's code) would see it.
    const beforeSteps = deploy.slice(0, deploy.indexOf("    steps:"));
    assert.doesNotMatch(beforeSteps, /secrets\./);
    assert.doesNotMatch(plan, /secrets\./);
  });

  it("checks the credentials first, and deploys only after the tests, then checks /health", () => {
    const check = stepWith(deploySteps, /- name: Check the Cloudflare credentials$/m);
    const install = stepWith(deploySteps, /run: npm ci /);
    const test = stepWith(deploySteps, /run: npm test$/m);
    const release = stepWith(deploySteps, /wrangler deploy/);
    const verify = stepWith(deploySteps, /- name: Check that the new version answers$/m);
    assert.ok(check < install && install < test && test < release && release < verify);
    for (const step of [check, install, test, release, verify]) {
      assert.doesNotMatch(deploySteps[step], /^ +(continue-on-error|if):/m);
    }
  });

  it("installs without install scripts and deploys with the locked wrangler, tagged with the commit", () => {
    assert.match(deploySteps[stepWith(deploySteps, /run: npm ci /)], /--ignore-scripts/);
    const release = deploySteps[stepWith(deploySteps, /wrangler deploy/)];
    assert.match(release, /\.\/node_modules\/\.bin\/wrangler deploy/);
    assert.match(release, /--var "GIT_SHA:\$SHA"/);
    assert.match(release, /--tag "\$SHA"/);
    assert.match(release, /--message "/);
    assert.match(deploy, /^ {6}SHA: \$\{\{ github\.sha \}\}$/m);
  });
});

describe("monitor.yml", () => {
  const text = read("monitor.yml");
  const { check } = jobs(text);

  it("pins every action, limits every job in time and grants nothing by default", () => {
    pinnedAndLimited(text);
  });

  it("may read the repository and write issues, and nothing else", () => {
    assert.match(check, /^ {4}permissions:\n {6}contents: read\n {6}issues: write\n(?! {6})/m);
  });

  it("runs every six hours and by hand, the checks in scripts/monitor.mjs", () => {
    assert.match(text, /^ {4}- cron: "\d+ \*\/6 \* \* \*"$/m);
    assert.match(text, /^ {2}workflow_dispatch:$/m);
    assert.match(check, /sparse-checkout: scripts\/monitor\.mjs$/m);
    assert.match(check, /^ {8}run: node scripts\/monitor\.mjs$/m);
  });
});
