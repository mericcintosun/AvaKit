// A tripwire for the properties of .github/workflows/deploy-workers.yml and
// .github/workflows/monitor.yml that must not be lost quietly: the tests run
// in a job of their own, with no environment and no secret; the Cloudflare
// token is only ever handed to the step that deploys, in the approval-gated
// environment, after those tests have passed; every action is pinned to a
// commit; no checkout keeps its credentials; every job has a time limit and
// only the permissions it needs.
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

/** Every checkout in `text` leaves no credentials behind for later steps. */
function checkoutsForgetCredentials(text) {
  const checkouts = steps(text).filter((step) => /uses: actions\/checkout@/.test(step));
  assert.ok(checkouts.length > 0);
  for (const step of checkouts) {
    assert.match(
      step,
      /^ +persist-credentials: false$/m,
      `a checkout keeps its credentials:\n${step}`,
    );
  }
}

/** The value of a secret, as opposed to an expression that only asks whether it is set. */
const secretValue = (name) => new RegExp(`\\$\\{\\{ secrets\\.${name} \\}\\}`);

describe("deploy-workers.yml", () => {
  const text = read("deploy-workers.yml");
  const { plan, test: testJob, deploy } = jobs(text);
  const testSteps = steps(testJob);
  const deploySteps = steps(deploy);

  it("pins every action, limits every job in time and grants nothing by default", () => {
    pinnedAndLimited(text);
  });

  it("deploys in the approval-gated environment, with read-only repository access", () => {
    assert.match(deploy, /^ {4}environment:\n {6}name: cloudflare-workers$/m);
    for (const job of [plan, testJob, deploy]) {
      assert.match(job, /^ {4}permissions:\n {6}contents: read\n(?! {6})/m);
    }
    // A fork has neither the environment nor the account.
    assert.match(plan, /^ {4}if: github\.repository == 'mericcintosun\/AvaKit'$/m);
    assert.match(testJob, /^ {4}if: github\.repository == 'mericcintosun\/AvaKit' && /m);
    assert.match(deploy, /^ {4}if: github\.repository == 'mericcintosun\/AvaKit' && /m);
  });

  it("keeps no checkout's credentials, and restores nothing from a cache", () => {
    checkoutsForgetCredentials(text);
    assert.doesNotMatch(text, /^ +cache(-dependency-path)?:/m);
    const setups = steps(text).filter((step) => /uses: actions\/setup-node@/.test(step));
    assert.ok(setups.length > 0);
    for (const step of setups) assert.match(step, /^ +package-manager-cache: false$/m);
  });

  it("runs the tests in a job of its own, with no environment and no secret", () => {
    assert.doesNotMatch(testJob, /^ {4}environment:/m);
    assert.doesNotMatch(testJob, /secrets\./);
    const install = stepWith(testSteps, /run: npm ci /);
    const run = stepWith(testSteps, /run: npm test$/m);
    assert.ok(install < run);
    assert.match(testSteps[install], /--ignore-scripts/);
    assert.match(testJob, /^ {4}needs: plan$/m);
  });

  it("deploys only once the tests have passed, and runs none itself", () => {
    assert.match(deploy, /^ {4}needs: \[plan, test\]$/m);
    // No status function in the condition, so GitHub's implicit success() applies.
    const condition = deploy.match(/^ {4}if: (.*)$/m)[1];
    assert.doesNotMatch(condition, /\b(always|failure|cancelled|success)\(/);
    assert.doesNotMatch(deploy, /npm (run )?test/);
  });

  it("hands the Cloudflare credentials to the deploy step only", () => {
    for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
      const holders = deploySteps
        .map((step, index) => (secretValue(name).test(step) ? index : -1))
        .filter((index) => index >= 0);
      assert.deepEqual(holders, [stepWith(deploySteps, /- name: Deploy$/m)], name);
    }
    // The check before it learns whether each one is set, and nothing more.
    const check = deploySteps[stepWith(deploySteps, /- name: Check the Cloudflare credentials$/m)];
    const asked = [...check.matchAll(/\$\{\{([^}]*)\}\}/g)].map(([, expression]) =>
      expression.trim(),
    );
    assert.deepEqual(asked, [
      "secrets.CLOUDFLARE_API_TOKEN != ''",
      "secrets.CLOUDFLARE_ACCOUNT_ID != ''",
    ]);
    // Not in a job-level env, where every step (and every dependency's code) would see it.
    const beforeSteps = deploy.slice(0, deploy.indexOf("    steps:"));
    assert.doesNotMatch(beforeSteps, /secrets\./);
    assert.doesNotMatch(plan, /secrets\./);
  });

  it("checks the credentials first, installs, deploys, then checks /health", () => {
    const check = stepWith(deploySteps, /- name: Check the Cloudflare credentials$/m);
    const install = stepWith(deploySteps, /run: npm ci /);
    const release = stepWith(deploySteps, /wrangler deploy/);
    const verify = stepWith(deploySteps, /- name: Check that the new version answers$/m);
    assert.ok(check < install && install < release && release < verify);
    for (const step of [check, install, release, verify]) {
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
    checkoutsForgetCredentials(text);
  });

  it("runs every six hours and by hand, the checks in scripts/monitor.mjs", () => {
    assert.match(text, /^ {4}- cron: "\d+ \*\/6 \* \* \*"$/m);
    assert.match(text, /^ {2}workflow_dispatch:$/m);
    assert.match(check, /sparse-checkout: scripts\/monitor\.mjs$/m);
    assert.match(check, /^ {8}run: node scripts\/monitor\.mjs$/m);
  });
});
