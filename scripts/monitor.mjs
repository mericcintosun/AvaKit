#!/usr/bin/env node
// The checks behind .github/workflows/monitor.yml.
//
// It asks avakit.dev and the two Cloudflare Workers whether they are up, and
// keeps one GitHub issue, labelled `monitor`, in step with the answers: the
// issue is opened when a check fails, updated while checks fail (with a comment
// whenever what fails changes), and closed once every check passes again.
//
// That issue is the alert. Once it says what fails, the run exits 0: GitHub
// also emails about every failed scheduled run, and a red run every six hours
// would only repeat the issue. The run exits 1 when no issue carries the news:
// a failing check in a dry run or without a token, or an issue GitHub would not
// let it write (whatever the checks found).
//
//   node scripts/monitor.mjs             check, then sync the issue when
//                                        GITHUB_TOKEN and GITHUB_REPOSITORY are set
//   node scripts/monitor.mjs --dry-run   check and print; never touch an issue
//
// Towards the services it only ever sends GETs. The faucet's /health asks the
// chain for the faucet's own balance and nothing else.
//
// MONITOR_SITE_URL, MONITOR_FAUCET_URL and MONITOR_TELEMETRY_URL point it at
// other deployments (a fork's, say); the defaults are AvaKit's own.

import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DEFAULT_TARGETS = {
  site: "https://avakit.dev",
  faucet: "https://avakit-faucet.avakit.workers.dev",
  telemetry: "https://avakit-telemetry.avakit.workers.dev",
};

/** The label of the one issue this script keeps. */
export const LABEL = "monitor";
const MARKER = /<!-- avakit-monitor failing="([^"]*)" -->/;

/** How an answer is fetched: a few tries for a failure that may pass, each with a time limit. */
const ATTEMPTS = 3;
const WAIT_MS = 10_000;
const TIMEOUT_MS = 20_000;

/** wei as AVAX, to four places, for people to read. */
export function avax(wei) {
  const value = BigInt(wei);
  const whole = value / 10n ** 18n;
  const fraction = ((value % 10n ** 18n) / 10n ** 14n).toString().padStart(4, "0");
  return `${whole}.${fraction}`;
}

/**
 * GET `url` until it answers with something other than a server error, at most
 * ATTEMPTS times. Resolves with the last outcome: `{ status, type, text, ms }`
 * for an answer, `{ error, ms }` for none.
 */
export async function get(url, { fetch, sleep, attempts = ATTEMPTS, waitMs = WAIT_MS }) {
  let outcome;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "avakit-monitor", "cache-control": "no-cache" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      outcome = {
        status: response.status,
        type: response.headers.get("content-type") ?? "",
        text: await response.text(),
        ms: Date.now() - started,
      };
      if (response.status < 500) return outcome;
    } catch (error) {
      outcome = { error: error?.cause?.code ?? error?.name ?? "error", ms: Date.now() - started };
    }
    if (attempt < attempts) await sleep(waitMs);
  }
  return outcome;
}

/** What happened to a request, as the end of a sentence about its URL. */
function described(outcome) {
  if (outcome.error) return `gave no answer (${outcome.error})`;
  return `answered HTTP ${outcome.status}`;
}

function parse(outcome) {
  try {
    return JSON.parse(outcome.text);
  } catch {
    return null;
  }
}

const pass = (id, name, detail) => ({ id, name, ok: true, detail });
const fail = (id, name, detail, hint) => ({ id, name, ok: false, detail, hint });

/** A page of the site: it must answer 200 with HTML. */
async function page(id, name, url, http) {
  const outcome = await get(url, http);
  if (outcome.status === 200 && outcome.type.includes("text/html")) {
    return pass(id, name, `HTTP 200 in ${outcome.ms} ms`);
  }
  const what =
    outcome.status === 200
      ? `answered HTTP 200 with ${outcome.type || "no content type"}, not a page`
      : described(outcome);
  return fail(id, name, `${url} ${what}`, "Look at the latest deployment of the site on Vercel.");
}

/** The version a Worker's /health reports, in words. */
function versionNote(version) {
  return version === "dev" ? "deployed by hand (version dev)" : `version ${version}`;
}

/** GET /health of the faucet, read into one row per thing that can be wrong. */
async function faucetChecks(base, http) {
  const url = `${base}/health`;
  const outcome = await get(url, http);
  const body = parse(outcome);
  const name = "Faucet";

  if (outcome.status !== 200 || body?.ok !== true) {
    const why = body?.error ? `: ${body.error}` : "";
    return [
      fail(
        "faucet",
        name,
        `${url} ${described(outcome)}${why}`,
        "Read the Worker's log: `cd services/faucet && npx wrangler tail`.",
      ),
    ];
  }
  if (typeof body.version !== "string") {
    return [
      fail(
        "faucet",
        name,
        `${url} does not report its version, so the deployed faucet predates it`,
        "Deploy services/faucet (Actions → Deploy · Cloudflare Workers).",
      ),
    ];
  }

  const checks = [pass("faucet", name, `up, ${versionNote(body.version)}`)];

  if (body.low === false) {
    checks.push(
      pass(
        "faucet-balance",
        "Faucet balance",
        `${avax(body.balance)} AVAX (warns under ${body.lowBelow})`,
      ),
    );
  } else if (body.low === true) {
    checks.push(
      fail(
        "faucet-balance",
        "Faucet balance",
        `${avax(body.balance)} AVAX, under ${body.lowBelow} AVAX`,
        `Send Fuji AVAX to the faucet's address ${body.address}, from the official faucet or a wallet of your own.`,
      ),
    );
  } else {
    checks.push(
      fail(
        "faucet-balance",
        "Faucet balance",
        "the faucet could not read its own balance: its RPC did not answer",
        "Check the Fuji RPC the faucet uses (FAUCET_FUJI_RPC, or the public one).",
      ),
    );
  }

  checks.push(
    body.paused === true
      ? fail(
          "faucet-paused",
          "Faucet switched on",
          "FAUCET_PAUSED is set: every drip is refused",
          "Resume it with `cd services/faucet && npx wrangler secret delete FAUCET_PAUSED`, once the reason for pausing it is gone.",
        )
      : pass("faucet-paused", "Faucet switched on", "not paused"),
  );

  const spent = [];
  const budgets = [];
  for (const lane of ["unverified", "verified"]) {
    const budget = body.today?.[lane];
    if (!budget) continue;
    budgets.push(`${lane} ${budget.drips}/${budget.max}`);
    // A budget of 0 is closed on purpose, not spent.
    if (budget.max > 0 && budget.drips >= budget.max) spent.push(lane);
  }
  checks.push(
    spent.length > 0
      ? fail(
          "faucet-budget",
          "Faucet daily budget",
          `spent on ${body.today.day}: ${budgets.join(", ")}`,
          "A spent budget refuses everyone until 00:00 UTC. Read the log for who drew on it (`npx wrangler tail`); raise FAUCET_DAILY_DRIPS in services/faucet/wrangler.toml if it was real use, or pause the faucet if it was not.",
        )
      : pass("faucet-budget", "Faucet daily budget", budgets.join(", ") || "not reported"),
  );
  return checks;
}

/** The telemetry collector: its /health, and /stats, which avakit.dev/stats reads. */
async function telemetryChecks(base, http) {
  const name = "Telemetry collector";
  const hint = "Read the Worker's log: `cd services/telemetry && npx wrangler tail`.";
  const [health, stats] = await Promise.all([
    get(`${base}/health`, http),
    get(`${base}/stats`, http),
  ]);

  const checks = [];
  const body = parse(health);
  if (health.status !== 200 || body?.ok !== true) {
    const why = body?.error ? `: ${body.error}` : "";
    checks.push(fail("telemetry", name, `/health ${described(health)}${why}`, hint));
  } else if (typeof body.version !== "string") {
    checks.push(
      fail(
        "telemetry",
        name,
        "/health does not report its version, so the deployed collector predates it",
        "Deploy services/telemetry (Actions → Deploy · Cloudflare Workers).",
      ),
    );
  } else {
    checks.push(pass("telemetry", name, `up, ${versionNote(body.version)}`));
  }

  const aggregate = parse(stats);
  if (stats.status === 200 && typeof aggregate?.scaffolds?.total === "number") {
    checks.push(
      pass(
        "telemetry-stats",
        "Telemetry /stats",
        `${aggregate.scaffolds.total} scaffolds counted, read at ${aggregate.updatedAt}`,
      ),
    );
  } else {
    checks.push(
      fail(
        "telemetry-stats",
        "Telemetry /stats",
        `/stats ${described(stats)}`,
        `${hint} After a schema change, see "Changing the schema" in services/telemetry/README.md.`,
      ),
    );
  }
  return checks;
}

/** Every check, in a fixed order. */
export async function runChecks({ targets = DEFAULT_TARGETS, fetch, sleep }) {
  const http = { fetch, sleep };
  const [home, newPage, faucet, telemetry] = await Promise.all([
    page("site", "avakit.dev", `${targets.site}/`, http),
    page("site-new", "avakit.dev/new", `${targets.site}/new`, http),
    faucetChecks(targets.faucet, http),
    telemetryChecks(targets.telemetry, http),
  ]);
  return [home, newPage, ...faucet, ...telemetry];
}

/** The rows as a Markdown table. Cells never hold a pipe or a line break. */
export function table(results) {
  const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\s+/g, " ");
  return [
    "| Check | Result | Detail |",
    "| --- | --- | --- |",
    ...results.map(
      (r) => `| ${cell(r.name)} | ${r.ok ? "pass" : "**FAIL**"} | ${cell(r.detail)} |`,
    ),
  ].join("\n");
}

export function issueTitle(failing) {
  return `Monitor: ${failing.map((r) => r.name).join(", ")} failing`.slice(0, 250);
}

export function issueBody(results, { runUrl, now }) {
  const failing = results.filter((r) => !r.ok);
  const lines = [
    `<!-- avakit-monitor failing="${failing.map((r) => r.id).join(" ")}" -->`,
    "The scheduled monitor (`.github/workflows/monitor.yml`) found a problem. It runs every six hours, keeps this issue up to date while anything fails, and closes it once every check passes again.",
    "",
    table(results),
    "",
    "**What to do**",
    "",
    ...failing.map((r) => `- **${r.name}**: ${r.hint ?? "see the detail above."}`),
    "",
    `Last checked ${now.toISOString().replace("T", " ").slice(0, 16)} UTC${runUrl ? ` in [this run](${runUrl})` : ""}.`,
  ];
  return lines.join("\n");
}

/** The failing check ids an issue body was written for, or null when it has no marker. */
export function failingIn(body) {
  const match = MARKER.exec(body ?? "");
  return match ? match[1].split(" ").filter(Boolean) : null;
}

/** A small GitHub REST client over `fetch`. Throws on any answer outside 2xx. */
export function github({ fetch, token, repo, apiUrl = "https://api.github.com" }) {
  return async (method, path, body) => {
    const response = await fetch(`${apiUrl}/repos/${repo}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "avakit-monitor",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // An error page rather than the API's JSON: the status still says enough.
    }
    // A 404 to a GET is an answer ("no such label"); anything else outside 2xx is not.
    if (!response.ok && !(method === "GET" && response.status === 404)) {
      throw new Error(
        `GitHub answered ${method} ${path} with HTTP ${response.status}: ${json?.message ?? "no message"}`,
      );
    }
    return { status: response.status, json };
  };
}

/**
 * Bring the monitor issue in line with `results`. Resolves with what was done:
 * `{ action: "none" | "opened" | "updated" | "closed", number? }`.
 */
export async function syncIssue(api, results, { runUrl, now }) {
  const failing = results.filter((r) => !r.ok);
  const listed = await api("GET", `/issues?state=open&labels=${LABEL}&per_page=100`);
  // The issues endpoint lists pull requests too; only an issue is this script's.
  const open = (listed.json ?? [])
    .filter((issue) => !issue.pull_request)
    .sort((a, b) => a.number - b.number);
  const issue = open[0];

  if (failing.length === 0) {
    if (!issue) return { action: "none" };
    await api("POST", `/issues/${issue.number}/comments`, {
      body: `Every check passes again${runUrl ? ` ([run](${runUrl}))` : ""}. Closing.\n\n${table(results)}`,
    });
    await api("PATCH", `/issues/${issue.number}`, { state: "closed", state_reason: "completed" });
    return { action: "closed", number: issue.number };
  }

  const title = issueTitle(failing);
  const body = issueBody(results, { runUrl, now });

  if (!issue) {
    const label = await api("GET", `/labels/${LABEL}`);
    if (label.status === 404) {
      await api("POST", "/labels", {
        name: LABEL,
        color: "b60205",
        description: "Opened and closed by the monitor workflow",
      });
    }
    const created = await api("POST", "/issues", { title, body, labels: [LABEL] });
    return { action: "opened", number: created.json.number };
  }

  // Editing the body notifies nobody; a comment does. So a comment is only
  // written when what fails has changed, not every six hours.
  const before = failingIn(issue.body) ?? [];
  const current = failing.map((r) => r.id);
  await api("PATCH", `/issues/${issue.number}`, { title, body });
  if (before.join(" ") !== current.join(" ")) {
    const names = (ids) =>
      results
        .filter((r) => ids.includes(r.id))
        .map((r) => r.name)
        .join(", ") || "nothing";
    const started = current.filter((id) => !before.includes(id));
    // Only a check that ran and passed has recovered. One that did not run this
    // time (the balance, while the faucet's /health is down) has not.
    const recovered = before.filter((id) => results.some((r) => r.id === id && r.ok));
    await api("POST", `/issues/${issue.number}/comments`, {
      body: [
        `What fails has changed${runUrl ? ` ([run](${runUrl}))` : ""}.`,
        "",
        `- Now failing: ${names(started)}`,
        `- Passing again: ${names(recovered)}`,
      ].join("\n"),
    });
  }
  return { action: "updated", number: issue.number };
}

/**
 * The whole run. Resolves with the exit code: 0 when every check passed, or
 * when the monitor issue now says what fails; 1 when a check failed and no
 * issue was written, or when writing the issue failed.
 */
export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
  now = () => new Date(),
} = {}) {
  const dryRun = argv.includes("--dry-run");
  const targets = {
    site: env.MONITOR_SITE_URL || DEFAULT_TARGETS.site,
    faucet: env.MONITOR_FAUCET_URL || DEFAULT_TARGETS.faucet,
    telemetry: env.MONITOR_TELEMETRY_URL || DEFAULT_TARGETS.telemetry,
  };

  const results = await runChecks({ targets, fetch, sleep });
  const failing = results.filter((r) => !r.ok);

  log(table(results));
  for (const r of failing) log(`::error title=Monitor · ${r.name}::${r.detail}`);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `## Monitor\n\n${table(results)}\n`);
  }

  const runUrl =
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : undefined;
  if (dryRun) {
    log("Dry run: the monitor issue is left alone.");
    return failing.length > 0 ? 1 : 0;
  }
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) {
    log("GITHUB_TOKEN or GITHUB_REPOSITORY is not set: the monitor issue is left alone.");
    return failing.length > 0 ? 1 : 0;
  }

  const api = github({
    fetch,
    token: env.GITHUB_TOKEN,
    repo: env.GITHUB_REPOSITORY,
    apiUrl: env.GITHUB_API_URL || undefined,
  });
  try {
    const done = await syncIssue(api, results, { runUrl, now: now() });
    log(
      done.number
        ? `Monitor issue #${done.number}: ${done.action}.`
        : "No monitor issue to change.",
    );
  } catch (error) {
    // The one case the issue cannot report, so the run has to.
    log(`::error title=Monitor issue::The monitor issue could not be updated: ${error.message}`);
    return 1;
  }
  // The issue now says what fails, if anything does.
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
