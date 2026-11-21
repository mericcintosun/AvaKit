import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ARTIFACT_PREFIX,
  failedAtLine,
  failureReport,
  LABEL,
  legKey,
  readSummaries,
  report,
  TITLE,
} from "./e2e-fuji-report.mjs";

const RUN = "https://github.com/mericcintosun/AvaKit/actions/runs/123";

/** A leg's summary as scripts/e2e-fuji.mjs writes it with --json. */
const failed = (name, reason, faucet = false) => ({
  ok: false,
  failure: { step: "x", name, reason, faucet },
});

const JOBS = [
  { name: "ubuntu-latest · Node 22 · up to the build", conclusion: "failure", url: `${RUN}/job/1` },
  {
    name: "ubuntu-latest · Node 24 · with the on-chain half",
    conclusion: "failure",
    url: `${RUN}/job/2`,
  },
  { name: "macos-latest · Node 24 · up to the build", conclusion: "success", url: `${RUN}/job/3` },
  {
    name: "windows-latest · Node 24 · up to the build",
    conclusion: "cancelled",
    url: `${RUN}/job/4`,
  },
  { name: "Report · e2e-failure issue", conclusion: null, url: `${RUN}/job/5` },
];

test("legKey turns a leg's job name into its artifact's suffix, and ignores other jobs", () => {
  assert.equal(legKey("ubuntu-latest · Node 24 · with the on-chain half"), "ubuntu-latest-node24");
  assert.equal(legKey("windows-latest · Node 24 · up to the build"), "windows-latest-node24");
  assert.equal(legKey("Report · e2e-failure issue"), null);
  assert.equal(legKey(undefined), null);
});

test("failedAtLine words the failure as the job summary does", () => {
  assert.equal(
    failedAtLine(failed("Install with npm", '"npm install" exited with code 1.')),
    'Failed at "Install with npm": "npm install" exited with code 1.',
  );
  assert.equal(
    failedAtLine(failed("Deploy", "line one\n  line two")),
    'Failed at "Deploy": line one line two',
  );
  assert.equal(failedAtLine({ ok: true, failure: null }), null);
  assert.equal(failedAtLine(undefined), null);
});

test("failureReport lists each leg that did not pass with its Failed at line, quoted", () => {
  const summaries = new Map([
    ["ubuntu-latest-node22", failed("Install with npm", '"npm install" exited with code 1.')],
    [
      "ubuntu-latest-node24",
      failed("Deploy the contract", "The faucet refused ``` @someone", true),
    ],
  ]);
  const body = failureReport({
    runUrl: RUN,
    event: "schedule",
    version: "latest",
    jobs: JOBS,
    summaries,
  });

  assert.match(
    body,
    /^The end-to-end run of the published packages did not pass: https:\/\/github\.com\/mericcintosun\/AvaKit\/actions\/runs\/123$/m,
  );
  assert.match(body, /^- Started by: the daily schedule$/m);
  assert.match(body, /^- Version tested: `latest`$/m);
  assert.match(
    body,
    /\[ubuntu-latest · Node 22 · up to the build\]\(https:\/\/github\.com\/mericcintosun\/AvaKit\/actions\/runs\/123\/job\/1\): failure/,
  );
  assert.match(body, /^ {2}Failed at "Install with npm": "npm install" exited with code 1\.$/m);
  // Tool output cannot close its code block, and stays inside it.
  assert.match(body, /^ {2}Failed at "Deploy the contract": The faucet refused ` ` ` @someone$/m);
  assert.match(body, /names the faucet/);
  assert.match(
    body,
    /\[windows-latest · Node 24 · up to the build\]\([^)]+\): cancelled\n\n {2}It left no summary/,
  );
  assert.doesNotMatch(body, /macos-latest/);
  assert.doesNotMatch(body, /Report ·/);
  assert.match(body, /closes this issue/);
});

test("failureReport names a dispatched run and its version, and a failure outside the legs", () => {
  const body = failureReport({
    runUrl: RUN,
    event: "workflow_dispatch",
    version: "0.2.0`x",
    attempt: 2,
    jobs: JOBS.filter((job) => job.conclusion === "success"),
    summaries: new Map(),
  });
  assert.match(body, /^- Started by: `workflow_dispatch` \(Run workflow\)$/m);
  assert.match(body, /^- Version tested: `0\.2\.0'x`$/m);
  assert.match(body, /^- Attempt: 2$/m);
  assert.match(body, /failed outside them/);
});

test("readSummaries reads the artifacts gh run download wrote, one directory each", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-report-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, contents] of [
    [`${ARTIFACT_PREFIX}ubuntu-latest-node24`, JSON.stringify(failed("A", "b"))],
    [`${ARTIFACT_PREFIX}macos-latest-node24`, "{ not json"],
    ["something-else", JSON.stringify(failed("C", "d"))],
  ]) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "e2e-summary.json"), contents);
  }
  const summaries = readSummaries(dir);
  assert.deepEqual([...summaries.keys()], ["ubuntu-latest-node24"]);
  assert.equal(readSummaries(join(dir, "missing")).size, 0);
});

/**
 * A stand-in for the GitHub CLI: answers from `answers` (by the first words of
 * the call) and records every call with its stdin.
 */
function fakeGh({ openIssues = [], labels = [LABEL], artifacts = [], onDownload } = {}) {
  const calls = [];
  const gh = (args, input) => {
    calls.push({ args, input });
    const [command, sub] = args;
    if (command === "api" && args.some((arg) => arg.includes("/issues?labels="))) {
      return openIssues.map((number) => `${JSON.stringify({ number })}\n`).join("");
    }
    if (command === "api" && args.some((arg) => /\/attempts\/\d+\/jobs/.test(arg))) {
      return JOBS.map((job) => `${JSON.stringify(job)}\n`).join("");
    }
    if (command === "api" && args.some((arg) => arg.includes("/artifacts"))) {
      return artifacts.map((name) => `${JSON.stringify({ name })}\n`).join("");
    }
    if (command === "api" && args.some((arg) => arg.includes("/labels"))) {
      return labels.map((name) => `${JSON.stringify({ name })}\n`).join("");
    }
    if (command === "run" && sub === "download") {
      onDownload?.(args[args.indexOf("--dir") + 1]);
      return "";
    }
    if (command === "issue" && sub === "create") return "https://github.com/o/r/issues/7\n";
    return "";
  };
  return { gh, calls };
}

const ENV = {
  GITHUB_REPOSITORY: "mericcintosun/AvaKit",
  GITHUB_RUN_ID: "123",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_EVENT_NAME: "schedule",
};

const writes = (calls) => calls.filter(({ args }) => args[0] !== "api" && args[0] !== "run");

test("a failing run with no open issue creates the label and opens one with the report", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-report-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { gh, calls } = fakeGh({
    labels: ["bug"],
    artifacts: [`${ARTIFACT_PREFIX}ubuntu-latest-node22`, "unrelated"],
    onDownload: (target) => {
      mkdirSync(join(target, `${ARTIFACT_PREFIX}ubuntu-latest-node22`), { recursive: true });
      writeFileSync(
        join(target, `${ARTIFACT_PREFIX}ubuntu-latest-node22`, "e2e-summary.json"),
        JSON.stringify(failed("Install with npm", "boom")),
      );
    },
  });
  const done = report({ env: { ...ENV, RESULT: "failure" }, gh, log: () => {}, downloadDir: dir });

  assert.equal(done, "opened");
  const download = calls.find(({ args }) => args[0] === "run");
  assert.deepEqual(download.args, [
    "run",
    "download",
    "123",
    "--repo",
    "mericcintosun/AvaKit",
    "--pattern",
    `${ARTIFACT_PREFIX}*`,
    "--dir",
    dir,
  ]);
  const [label, create] = writes(calls);
  assert.deepEqual(label.args.slice(0, 5), [
    "label",
    "create",
    LABEL,
    "--repo",
    "mericcintosun/AvaKit",
  ]);
  assert.deepEqual(create.args, [
    "issue",
    "create",
    "--repo",
    "mericcintosun/AvaKit",
    "--title",
    TITLE,
    "--label",
    LABEL,
    "--body-file",
    "-",
  ]);
  assert.match(create.input, /Failed at "Install with npm": boom/);
  assert.match(create.input, /actions\/runs\/123/);
});

test("a failing run comments on the open issue instead of opening another", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-report-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { gh, calls } = fakeGh({ openIssues: [41, 42] });
  const done = report({
    env: { ...ENV, RESULT: "cancelled" },
    gh,
    log: () => {},
    downloadDir: dir,
  });

  assert.equal(done, "commented");
  // No artifact to download: every leg stopped before writing its summary.
  assert.equal(calls.filter(({ args }) => args[0] === "run").length, 0);
  const [comment, ...rest] = writes(calls);
  assert.deepEqual(comment.args, [
    "issue",
    "comment",
    "41",
    "--repo",
    "mericcintosun/AvaKit",
    "--body-file",
    "-",
  ]);
  assert.match(comment.input, /It left no summary/);
  assert.deepEqual(rest, []);
});

test("a passing run of latest closes every open e2e-failure issue, and one of another version closes none", () => {
  const closing = fakeGh({ openIssues: [41] });
  assert.equal(
    report({
      env: { ...ENV, RESULT: "success", VERSION: "latest" },
      gh: closing.gh,
      log: () => {},
    }),
    "closed",
  );
  assert.deepEqual(
    writes(closing.calls).map(({ args }) => args),
    [
      [
        "issue",
        "close",
        "41",
        "--repo",
        "mericcintosun/AvaKit",
        "--reason",
        "completed",
        "--comment",
        "Passed again (`latest`): https://github.com/mericcintosun/AvaKit/actions/runs/123",
      ],
    ],
  );

  const older = fakeGh({ openIssues: [41] });
  assert.equal(
    report({
      env: { ...ENV, RESULT: "success", VERSION: "0.2.0", GITHUB_EVENT_NAME: "workflow_dispatch" },
      gh: older.gh,
      log: () => {},
    }),
    "nothing",
  );
  assert.deepEqual(writes(older.calls), []);

  const quiet = fakeGh();
  assert.equal(
    report({ env: { ...ENV, RESULT: "success" }, gh: quiet.gh, log: () => {} }),
    "nothing",
  );
  assert.deepEqual(writes(quiet.calls), []);
});

test("report refuses to run without the repository and run it reports on", () => {
  assert.throws(
    () => report({ env: { RESULT: "failure" }, gh: fakeGh().gh }),
    /GITHUB_REPOSITORY and GITHUB_RUN_ID/,
  );
});
