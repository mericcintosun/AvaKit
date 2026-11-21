// Keep one GitHub issue open while the end-to-end run of the published
// packages (.github/workflows/e2e-fuji.yml) is red, and close it once it is
// green again, so that a failing daily run reaches someone instead of waiting
// on the Actions tab.
//
// The report job of that workflow runs this after the legs, on every
// scheduled or dispatched run:
//   - when a leg did not pass, it comments on the open issue labelled
//     e2e-failure, or opens one (and creates the label when it is missing),
//     with a link to the run, every leg that did not pass, and that leg's
//     "Failed at" line: the first line of its job summary, which names the
//     step that failed and why, in the script's own words;
//   - when every leg passed on a run that tested `latest`, it closes the open
//     e2e-failure issue with a link to that run. A green run of another
//     version (Run workflow with a version) says nothing about what people
//     install, and closes nothing.
//
// It talks to GitHub through the GitHub CLI with GH_TOKEN (the job's token:
// issues: write, actions: read), and reads GITHUB_REPOSITORY, GITHUB_RUN_ID,
// GITHUB_RUN_ATTEMPT, GITHUB_SERVER_URL, GITHUB_EVENT_NAME, RESULT (the e2e
// job's result) and VERSION (the version that was tested) from the
// environment. The legs' summaries come from the run's e2e-fuji-* artifacts.
//
// The failure lines are quoted in code blocks: they carry tool output, which
// must not be read as Markdown or mention anyone.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LABEL = "e2e-failure";
export const LABEL_COLOR = "B60205";
export const LABEL_DESCRIPTION =
  "The end-to-end run of the published packages (e2e-fuji.yml) is failing";
export const TITLE = "E2E · Fuji · published packages is failing";
/** The leg artifacts are e2e-fuji-<os>-node<major>, as e2e-fuji.yml names them. */
export const ARTIFACT_PREFIX = "e2e-fuji-";

/**
 * The part of a leg's artifact name after ARTIFACT_PREFIX, from the leg's job
 * name (`ubuntu-latest · Node 24 · ...` gives `ubuntu-latest-node24`), or null
 * for a job that is not a leg, such as the report job itself.
 */
export function legKey(jobName) {
  const match = /^(\S+) · Node (\d+) · /.exec(jobName ?? "");
  return match ? `${match[1]}-node${match[2]}` : null;
}

const oneLine = (text, max = 1500) =>
  String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/**
 * The "Failed at" line of a leg's summary (the JSON that scripts/e2e-fuji.mjs
 * writes with --json), as its job summary words it, or null when the summary
 * records no failed step.
 */
export function failedAtLine(summary) {
  const failure = summary?.failure;
  if (!failure || typeof failure !== "object") return null;
  return `Failed at "${oneLine(failure.name, 200)}": ${oneLine(failure.reason)}`;
}

/** Text that cannot close the ```` fence it is quoted in. */
const unfenced = (text) => text.replace(/`{3,}/g, (ticks) => ticks.split("").join(" "));
/** Inline code that stays inline code. */
const code = (text) => `\`${oneLine(text, 100).replace(/`/g, "'")}\``;

/** The issue body (or comment) for a run in which something did not pass. */
export function failureReport({ runUrl, event, version, attempt = 1, jobs, summaries }) {
  const legs = jobs.filter((job) => legKey(job.name) !== null);
  const failed = legs.filter((job) => job.conclusion !== "success");
  const lines = [
    `The end-to-end run of the published packages did not pass: ${runUrl}`,
    "",
    `- Started by: ${event === "schedule" ? "the daily schedule" : `${code(event)} (Run workflow)`}`,
    `- Version tested: ${code(version)}`,
    ...(attempt > 1 ? [`- Attempt: ${attempt}`] : []),
    "",
  ];
  if (failed.length === 0) {
    lines.push(
      "Every leg passed, so the run failed outside them (for example in a job that checks the legs). Read the run's log.",
      "",
    );
  } else {
    lines.push("Legs that did not pass:", "");
    for (const job of failed) {
      const summary = summaries.get(legKey(job.name));
      lines.push(`- [${job.name}](${job.url}): ${job.conclusion ?? "did not finish"}`);
      const line = failedAtLine(summary);
      if (line) {
        lines.push("", "  ````text", `  ${unfenced(line)}`, "  ````");
        if (summary.failure.faucet === true) {
          lines.push(
            "",
            "  The failing tool's answer names the faucet: the wallet that signs could not be funded from the shared, rate-limited AvaKit faucet. By itself that does not mean a package is broken.",
          );
        }
      } else if (summary) {
        lines.push(
          "",
          "  Its summary records no failed step, so a step after the script failed (for example the check that a token was minted). Read the job log.",
        );
      } else {
        lines.push(
          "",
          "  It left no summary: it stopped before the script wrote one (in a setup step, on a timeout or in a crash). Read the job log.",
        );
      }
      lines.push("");
    }
  }
  lines.push(
    'Read each "Failed at" line before anything else: when the Fuji faucet refuses or is empty, the on-chain leg fails without a package being broken (see the comment at the top of `.github/workflows/e2e-fuji.yml`).',
    "",
    "The next run that tests `latest` and passes closes this issue.",
  );
  return `${lines.join("\n")}\n`;
}

/** The leg summaries in a directory that `gh run download -p 'e2e-fuji-*'` filled. */
export function readSummaries(dir) {
  const summaries = new Map();
  if (!existsSync(dir)) return summaries;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(ARTIFACT_PREFIX)) continue;
    const file = join(dir, entry.name, "e2e-summary.json");
    if (!existsSync(file)) continue;
    try {
      summaries.set(
        entry.name.slice(ARTIFACT_PREFIX.length),
        JSON.parse(readFileSync(file, "utf8")),
      );
    } catch {
      // A summary that does not parse is reported as no summary.
    }
  }
  return summaries;
}

/** `gh` with the job's environment; returns stdout and throws on a non-zero exit. */
export function ghCli(env = process.env) {
  return (args, input) => {
    const result = spawnSync("gh", args, { encoding: "utf8", env, input });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${(result.stderr || "").trim()}`);
    }
    return result.stdout;
  };
}

/** Lines of JSON, as `gh api --jq` prints them, parsed. */
const jsonLines = (text) =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));

/**
 * Open, update or close the e2e-failure issue for one run. Returns what it
 * did: "closed", "commented", "opened" or "nothing".
 */
export function report({ env, gh, log = console.log, downloadDir }) {
  const repo = env.GITHUB_REPOSITORY;
  const runId = env.GITHUB_RUN_ID;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") || !/^\d+$/.test(runId ?? "")) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_RUN_ID must be set");
  }
  const server = env.GITHUB_SERVER_URL || "https://github.com";
  const runUrl = `${server}/${repo}/actions/runs/${runId}`;
  const attempt = Number(env.GITHUB_RUN_ATTEMPT || 1);
  const version = (env.VERSION || "").trim() || "latest";
  const open = jsonLines(
    gh([
      "api",
      `repos/${repo}/issues?labels=${LABEL}&state=open&per_page=20`,
      "--jq",
      ".[] | select(.pull_request == null) | {number}",
    ]),
  ).map((issue) => issue.number);

  if (env.RESULT === "success") {
    if (version !== "latest") {
      log(`Passed, but on ${version}, not latest: the e2e-failure issue is left as it is.`);
      return "nothing";
    }
    for (const number of open) {
      gh([
        "issue",
        "close",
        String(number),
        "--repo",
        repo,
        "--reason",
        "completed",
        "--comment",
        `Passed again (\`latest\`): ${runUrl}`,
      ]);
      log(`Closed #${number}.`);
    }
    if (open.length === 0) log("Passed, and no e2e-failure issue is open.");
    return open.length > 0 ? "closed" : "nothing";
  }

  const jobs = jsonLines(
    gh([
      "api",
      "--paginate",
      `repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`,
      "--jq",
      ".jobs[] | {name, conclusion, url: .html_url}",
    ]),
  );
  const artifacts = jsonLines(
    gh([
      "api",
      "--paginate",
      `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
      "--jq",
      ".artifacts[] | {name}",
    ]),
  ).filter(({ name }) => name.startsWith(ARTIFACT_PREFIX));
  if (artifacts.length > 0) {
    gh([
      "run",
      "download",
      runId,
      "--repo",
      repo,
      "--pattern",
      `${ARTIFACT_PREFIX}*`,
      "--dir",
      downloadDir,
    ]);
  }
  const body = failureReport({
    runUrl,
    event: env.GITHUB_EVENT_NAME,
    version,
    attempt,
    jobs,
    summaries: readSummaries(downloadDir),
  });

  if (open.length > 0) {
    gh(["issue", "comment", String(open[0]), "--repo", repo, "--body-file", "-"], body);
    log(`Commented on #${open[0]}.`);
    return "commented";
  }
  const labels = jsonLines(
    gh(["api", `repos/${repo}/labels?per_page=100`, "--paginate", "--jq", ".[] | {name}"]),
  );
  if (!labels.some(({ name }) => name === LABEL)) {
    gh([
      "label",
      "create",
      LABEL,
      "--repo",
      repo,
      "--color",
      LABEL_COLOR,
      "--description",
      LABEL_DESCRIPTION,
    ]);
    log(`Created the ${LABEL} label.`);
  }
  const url = gh(
    ["issue", "create", "--repo", repo, "--title", TITLE, "--label", LABEL, "--body-file", "-"],
    body,
  ).trim();
  log(`Opened ${url}`);
  return "opened";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const downloadDir = mkdtempSync(join(tmpdir(), "e2e-fuji-report-"));
  try {
    report({ env: process.env, gh: ghCli(), downloadDir });
  } catch (error) {
    console.error(`::error title=E2E report::${error.message.split("\n")[0]}`);
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    rmSync(downloadDir, { recursive: true, force: true });
  }
}
