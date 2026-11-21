// Tests for scripts/monitor.mjs, the checks behind .github/workflows/monitor.yml.
// Nothing here reaches a network: every answer comes from a stand-in `fetch`.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  avax,
  failingIn,
  github,
  issueBody,
  issueTitle,
  LABEL,
  main,
  runChecks,
  syncIssue,
} from "./monitor.mjs";

const TARGETS = {
  site: "https://site.test",
  faucet: "https://faucet.test",
  telemetry: "https://telemetry.test",
};
const SHA = "0123456789abcdef0123456789abcdef01234567";
const NOW = new Date(Date.UTC(2026, 10, 21, 18, 0, 0));

const healthyFaucet = (overrides = {}) => ({
  ok: true,
  version: SHA,
  address: "0x5becBFE3134BF55b328612b159600587C15677D2",
  chainId: 43113,
  balance: "3791660737465741668",
  low: false,
  lowBelow: "1",
  amount: "0.02",
  turnstile: false,
  paused: false,
  today: {
    day: "2026-11-21",
    unverified: { drips: 3, max: 50 },
    verified: { drips: 0, max: 100 },
  },
  ...overrides,
});

/** Every service well, with `overrides` replacing single answers. */
const routes = (overrides = {}) => ({
  [`${TARGETS.site}/`]: { html: "<!doctype html><title>AvaKit</title>" },
  [`${TARGETS.site}/new`]: { html: "<!doctype html><title>New</title>" },
  [`${TARGETS.faucet}/health`]: { json: healthyFaucet() },
  [`${TARGETS.telemetry}/health`]: { json: { ok: true, version: SHA } },
  [`${TARGETS.telemetry}/stats`]: {
    json: { scaffolds: { total: 12 }, updatedAt: "2026-11-21T15:14:31.753Z" },
  },
  ...overrides,
});

/**
 * A `fetch` that answers from `table`: URL (or "METHOD URL") → an answer, a
 * list of answers given in turn, a function of the request, or an Error to
 * throw. Unknown URLs get a 404. Every request is recorded.
 */
function fakeFetch(table) {
  const calls = [];
  const served = new Map();
  const fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({
      method,
      url: String(url),
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const key = table[`${method} ${url}`] !== undefined ? `${method} ${url}` : String(url);
    let answer = table[key];
    if (Array.isArray(answer)) {
      const n = served.get(key) ?? 0;
      served.set(key, n + 1);
      answer = answer[Math.min(n, answer.length - 1)];
    }
    if (typeof answer === "function") answer = answer(init);
    if (answer instanceof Error) throw answer;
    if (!answer) return new Response("Not found", { status: 404 });
    const { status = 200, json, html, text = "" } = answer;
    if (json !== undefined) return Response.json(json, { status });
    if (html !== undefined) {
      return new Response(html, {
        status,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response(text, { status });
  };
  return { fetch, calls };
}

const sleeps = [];
const sleep = async (ms) => {
  sleeps.push(ms);
};

async function check(overrides) {
  const { fetch, calls } = fakeFetch(routes(overrides));
  const results = await runChecks({ targets: TARGETS, fetch, sleep });
  return { results, calls, row: (id) => results.find((r) => r.id === id) };
}

const failing = (results) => results.filter((r) => !r.ok).map((r) => r.id);

describe("the checks", () => {
  it("all pass when the site and both Workers are well", async () => {
    const { results } = await check();

    assert.deepEqual(
      results.map((r) => [r.id, r.ok]),
      [
        ["site", true],
        ["site-new", true],
        ["faucet", true],
        ["faucet-balance", true],
        ["faucet-paused", true],
        ["faucet-budget", true],
        ["telemetry", true],
        ["telemetry-stats", true],
      ],
    );
    const detail = Object.fromEntries(results.map((r) => [r.id, r.detail]));
    assert.equal(detail.faucet, `up, version ${SHA}`);
    assert.equal(detail["faucet-balance"], "3.7916 AVAX (warns under 1)");
    assert.equal(detail["faucet-budget"], "unverified 3/50, verified 0/100");
  });

  it("fail on a low faucet, naming the balance and the address to top up", async () => {
    const { results, row } = await check({
      [`${TARGETS.faucet}/health`]: {
        json: healthyFaucet({ balance: "800000000000000000", low: true }),
      },
    });

    assert.deepEqual(failing(results), ["faucet-balance"]);
    assert.equal(row("faucet-balance").detail, "0.8000 AVAX, under 1 AVAX");
    assert.match(row("faucet-balance").hint, /0x5becBFE3134BF55b328612b159600587C15677D2/);
  });

  it("fail when the faucet cannot read its own balance", async () => {
    const { results, row } = await check({
      [`${TARGETS.faucet}/health`]: { json: healthyFaucet({ balance: null, low: null }) },
    });

    assert.deepEqual(failing(results), ["faucet-balance"]);
    assert.match(row("faucet-balance").detail, /could not read its own balance/);
  });

  it("fail while the kill switch is on", async () => {
    const { results, row } = await check({
      [`${TARGETS.faucet}/health`]: { json: healthyFaucet({ paused: true }) },
    });

    assert.deepEqual(failing(results), ["faucet-paused"]);
    assert.match(row("faucet-paused").hint, /wrangler secret delete FAUCET_PAUSED/);
  });

  it("fail on a spent daily budget, but not on one closed on purpose", async () => {
    const spent = await check({
      [`${TARGETS.faucet}/health`]: {
        json: healthyFaucet({
          today: {
            day: "2026-11-21",
            unverified: { drips: 50, max: 50 },
            verified: { drips: 0, max: 0 },
          },
        }),
      },
    });
    assert.deepEqual(failing(spent.results), ["faucet-budget"]);
    assert.equal(
      spent.row("faucet-budget").detail,
      "spent on 2026-11-21: unverified 50/50, verified 0/0",
    );

    const closed = await check({
      [`${TARGETS.faucet}/health`]: {
        json: healthyFaucet({
          today: {
            day: "2026-11-21",
            unverified: { drips: 0, max: 0 },
            verified: { drips: 4, max: 100 },
          },
        }),
      },
    });
    assert.deepEqual(failing(closed.results), []);
  });

  it("report a faucet deployed before /health named its version as one failure", async () => {
    // What the live faucet answers until the next deploy.
    const { results, row } = await check({
      [`${TARGETS.faucet}/health`]: {
        json: {
          ok: true,
          address: "0x5becBFE3134BF55b328612b159600587C15677D2",
          chainId: 43113,
          balance: "3791660737465741668",
          amount: "0.02",
          turnstile: false,
        },
      },
    });

    assert.deepEqual(failing(results), ["faucet"]);
    assert.equal(row("faucet-balance"), undefined);
    assert.match(row("faucet").hint, /Deploy services\/faucet/);
  });

  it("pass a Worker deployed by hand, and say so", async () => {
    const { results, row } = await check({
      [`${TARGETS.faucet}/health`]: { json: healthyFaucet({ version: "dev" }) },
      [`${TARGETS.telemetry}/health`]: { json: { ok: true, version: "dev" } },
    });

    assert.deepEqual(failing(results), []);
    assert.equal(row("faucet").detail, "up, deployed by hand (version dev)");
    assert.equal(row("telemetry").detail, "up, deployed by hand (version dev)");
  });

  it("quote a misconfigured faucet's own words, after asking three times", async () => {
    sleeps.length = 0;
    const { results, row, calls } = await check({
      [`${TARGETS.faucet}/health`]: {
        status: 500,
        json: {
          ok: false,
          version: SHA,
          error: "Faucet key not configured.",
          code: "misconfigured",
        },
      },
    });

    assert.deepEqual(failing(results), ["faucet"]);
    assert.equal(
      row("faucet").detail,
      "https://faucet.test/health answered HTTP 500: Faucet key not configured.",
    );
    assert.equal(calls.filter((c) => c.url === `${TARGETS.faucet}/health`).length, 3);
    assert.deepEqual(sleeps, [10_000, 10_000]);
  });

  it("accept a server error that passes on the next try", async () => {
    const { results, calls } = await check({
      [`${TARGETS.site}/`]: [{ status: 502, text: "Bad gateway" }, { html: "<!doctype html>" }],
    });

    assert.deepEqual(failing(results), []);
    assert.equal(calls.filter((c) => c.url === `${TARGETS.site}/`).length, 2);
  });

  it("take a missing page as an answer, without asking again", async () => {
    const { results, row, calls } = await check({ [`${TARGETS.site}/new`]: { status: 404 } });

    assert.deepEqual(failing(results), ["site-new"]);
    assert.equal(row("site-new").detail, "https://site.test/new answered HTTP 404");
    assert.equal(calls.filter((c) => c.url === `${TARGETS.site}/new`).length, 1);
  });

  it("fail a page that is not HTML, and a service that does not answer", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    });
    const { results, row } = await check({
      [`${TARGETS.site}/`]: { json: { not: "a page" } },
      [`${TARGETS.telemetry}/stats`]: refused,
    });

    assert.deepEqual(failing(results), ["site", "telemetry-stats"]);
    assert.equal(row("telemetry-stats").detail, "/stats answered no answer (ECONNREFUSED)");
  });

  it("fail a telemetry collector that cannot count, or predates its version", async () => {
    const unsalted = await check({
      [`${TARGETS.telemetry}/health`]: {
        status: 500,
        json: { ok: false, version: SHA, error: "Collector not configured." },
      },
    });
    assert.deepEqual(failing(unsalted.results), ["telemetry"]);
    assert.equal(
      unsalted.row("telemetry").detail,
      "/health answered HTTP 500: Collector not configured.",
    );

    // What the live collector answers until the next deploy.
    const old = await check({ [`${TARGETS.telemetry}/health`]: { json: { ok: true } } });
    assert.deepEqual(failing(old.results), ["telemetry"]);
    assert.match(old.row("telemetry").hint, /Deploy services\/telemetry/);
  });

  it("send only GETs, and never a credential, to the services", async () => {
    const { calls } = await check();
    for (const call of calls) {
      assert.equal(call.method, "GET");
      assert.equal(call.headers.authorization, undefined);
    }
  });
});

describe("the issue text", () => {
  it("names what fails, how to fix it and when it was checked, behind a marker", async () => {
    const { results } = await check({
      [`${TARGETS.faucet}/health`]: { json: healthyFaucet({ paused: true }) },
      [`${TARGETS.site}/new`]: { status: 404 },
    });
    const failed = results.filter((r) => !r.ok);

    assert.equal(issueTitle(failed), "Monitor: avakit.dev/new, Faucet switched on failing");
    const body = issueBody(results, { runUrl: "https://runs.test/1", now: NOW });
    assert.deepEqual(failingIn(body), ["site-new", "faucet-paused"]);
    assert.match(
      body,
      /\| avakit\.dev\/new \| \*\*FAIL\*\* \| https:\/\/site\.test\/new answered HTTP 404 \|/,
    );
    assert.match(body, /- \*\*Faucet switched on\*\*: Resume it with/);
    assert.match(
      body,
      /Last checked 2026-11-21 18:00 UTC in \[this run\]\(https:\/\/runs\.test\/1\)\./,
    );
  });

  it("formats AVAX to four places", () => {
    assert.equal(avax("3791660737465741668"), "3.7916");
    assert.equal(avax("1000000000000000000"), "1.0000");
    assert.equal(avax("0"), "0.0000");
  });

  it("reads no marker from a body without one", () => {
    assert.equal(failingIn("written by hand"), null);
    assert.equal(failingIn(undefined), null);
  });
});

/** A stand-in GitHub API: `issues` are the open ones, `label` whether the label exists. */
function fakeApi({ issues = [], label = true } = {}) {
  const calls = [];
  let next = 41;
  const api = async (method, path, body) => {
    calls.push([method, path, body]);
    if (method === "GET" && path.startsWith("/issues?")) return { status: 200, json: issues };
    if (method === "GET" && path === `/labels/${LABEL}`) {
      return label ? { status: 200, json: { name: LABEL } } : { status: 404, json: null };
    }
    if (method === "POST" && path === "/issues") return { status: 201, json: { number: next++ } };
    return { status: 200, json: {} };
  };
  return { api, calls, paths: () => calls.map(([method, path]) => `${method} ${path}`) };
}

async function resultsWith(overrides) {
  return (await check(overrides)).results;
}

describe("the monitor issue", () => {
  const lowFaucet = {
    [`${TARGETS.faucet}/health`]: { json: healthyFaucet({ balance: "1", low: true }) },
  };

  it("is opened, with its label created first, when a check fails", async () => {
    const github = fakeApi({ label: false });
    const results = await resultsWith(lowFaucet);

    const done = await syncIssue(github.api, results, { runUrl: "https://runs.test/1", now: NOW });

    assert.deepEqual(done, { action: "opened", number: 41 });
    assert.deepEqual(github.paths(), [
      "GET /issues?state=open&labels=monitor&per_page=100",
      "GET /labels/monitor",
      "POST /labels",
      "POST /issues",
    ]);
    const [, , created] = github.calls.at(-1);
    assert.equal(created.title, "Monitor: Faucet balance failing");
    assert.deepEqual(created.labels, [LABEL]);
    assert.deepEqual(failingIn(created.body), ["faucet-balance"]);
  });

  it("does not create a label that exists", async () => {
    const github = fakeApi({ label: true });
    await syncIssue(github.api, await resultsWith(lowFaucet), { now: NOW });
    assert.ok(!github.paths().includes("POST /labels"));
  });

  it("is updated quietly while the same checks keep failing", async () => {
    const results = await resultsWith(lowFaucet);
    const open = { number: 7, body: issueBody(results, { now: NOW }) };
    const github = fakeApi({ issues: [open] });

    const done = await syncIssue(github.api, results, { now: NOW });

    assert.deepEqual(done, { action: "updated", number: 7 });
    assert.deepEqual(github.paths(), [
      "GET /issues?state=open&labels=monitor&per_page=100",
      "PATCH /issues/7",
    ]);
  });

  it("gets a comment when what fails changes", async () => {
    const before = await resultsWith(lowFaucet);
    const open = { number: 7, body: issueBody(before, { now: NOW }) };
    const github = fakeApi({ issues: [open] });
    const after = await resultsWith({
      [`${TARGETS.faucet}/health`]: { json: healthyFaucet({ paused: true }) },
    });

    await syncIssue(github.api, after, { runUrl: "https://runs.test/2", now: NOW });

    assert.deepEqual(github.paths().slice(1), ["PATCH /issues/7", "POST /issues/7/comments"]);
    const [, , comment] = github.calls.at(-1);
    assert.match(comment.body, /- Now failing: Faucet switched on/);
    assert.match(comment.body, /- Passing again: Faucet balance/);
  });

  it("does not call a check that did not run this time recovered", async () => {
    const before = await resultsWith(lowFaucet);
    const open = { number: 7, body: issueBody(before, { now: NOW }) };
    const github = fakeApi({ issues: [open] });
    const down = await resultsWith({ [`${TARGETS.faucet}/health`]: { status: 404 } });

    await syncIssue(github.api, down, { now: NOW });

    const [, , comment] = github.calls.at(-1);
    assert.match(comment.body, /- Now failing: Faucet\n/);
    assert.match(comment.body, /- Passing again: nothing/);
  });

  it("is closed, with a comment, once every check passes", async () => {
    const github = fakeApi({ issues: [{ number: 7, body: "" }] });

    const done = await syncIssue(github.api, await resultsWith(), {
      runUrl: "https://runs.test/3",
      now: NOW,
    });

    assert.deepEqual(done, { action: "closed", number: 7 });
    assert.deepEqual(github.paths().slice(1), ["POST /issues/7/comments", "PATCH /issues/7"]);
    assert.deepEqual(github.calls.at(-1)[2], { state: "closed", state_reason: "completed" });
  });

  it("is left alone when everything passes and none is open", async () => {
    const github = fakeApi();
    assert.deepEqual(await syncIssue(github.api, await resultsWith(), { now: NOW }), {
      action: "none",
    });
    assert.equal(github.calls.length, 1);
  });

  it("is never a pull request, and is the oldest open one", async () => {
    const github = fakeApi({
      issues: [
        { number: 12, body: "" },
        { number: 3, body: "", pull_request: { url: "https://api.test/pulls/3" } },
        { number: 9, body: "" },
      ],
    });
    assert.deepEqual(await syncIssue(github.api, await resultsWith(), { now: NOW }), {
      action: "closed",
      number: 9,
    });
  });
});

describe("the GitHub client", () => {
  it("calls the repository's REST API with the token", async () => {
    const { fetch, calls } = fakeFetch({
      "POST https://api.test/repos/o/r/issues": { status: 201, json: { number: 5 } },
    });
    const api = github({ fetch, token: "t0ken", repo: "o/r", apiUrl: "https://api.test" });

    assert.deepEqual(await api("POST", "/issues", { title: "x" }), {
      status: 201,
      json: { number: 5 },
    });
    assert.equal(calls[0].headers.authorization, "Bearer t0ken");
    assert.deepEqual(calls[0].body, { title: "x" });
  });

  it("takes a 404 to a GET as an answer and anything else outside 2xx as a failure", async () => {
    const { fetch } = fakeFetch({
      "GET https://api.test/repos/o/r/labels/monitor": {
        status: 404,
        json: { message: "Not Found" },
      },
      "POST https://api.test/repos/o/r/issues": {
        status: 403,
        json: { message: "Resource not accessible" },
      },
    });
    const api = github({ fetch, token: "t0ken", repo: "o/r", apiUrl: "https://api.test" });

    assert.equal((await api("GET", "/labels/monitor")).status, 404);
    await assert.rejects(api("POST", "/issues", {}), (error) => {
      assert.equal(
        error.message,
        "GitHub answered POST /issues with HTTP 403: Resource not accessible",
      );
      assert.ok(!error.message.includes("t0ken"));
      return true;
    });
  });
});

describe("a run", () => {
  const quiet = () => {};

  it("touches no issue in a dry run, even with a token, and exits 1 on a failure", async () => {
    const { fetch, calls } = fakeFetch(routes(lowFaucetRoutes()));
    const code = await main({
      argv: ["--dry-run"],
      env: { GITHUB_TOKEN: "t0ken", GITHUB_REPOSITORY: "o/r", ...targetEnv() },
      fetch,
      sleep,
      log: quiet,
    });

    assert.equal(code, 1);
    assert.ok(calls.every((call) => !call.url.includes("/repos/")));
  });

  it("touches no issue without a token, and exits 0 when everything passes", async () => {
    const { fetch, calls } = fakeFetch(routes());
    const lines = [];
    const code = await main({
      argv: [],
      env: targetEnv(),
      fetch,
      sleep,
      log: (l) => lines.push(l),
    });

    assert.equal(code, 0);
    assert.ok(calls.every((call) => !call.url.includes("/repos/")));
    assert.ok(
      lines.includes(
        "GITHUB_TOKEN or GITHUB_REPOSITORY is not set: the monitor issue is left alone.",
      ),
    );
  });

  it("opens the issue and writes the job summary in a scheduled run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avakit-monitor-"));
    const summary = join(dir, "summary.md");
    try {
      const api = "https://api.test/repos/o/r";
      const { fetch, calls } = fakeFetch({
        ...routes(lowFaucetRoutes()),
        [`GET ${api}/issues?state=open&labels=monitor&per_page=100`]: { json: [] },
        [`GET ${api}/labels/monitor`]: { json: { name: "monitor" } },
        [`POST ${api}/issues`]: { status: 201, json: { number: 13 } },
      });
      const lines = [];
      const code = await main({
        argv: [],
        env: {
          ...targetEnv(),
          GITHUB_TOKEN: "t0ken",
          GITHUB_REPOSITORY: "o/r",
          GITHUB_API_URL: "https://api.test",
          GITHUB_SERVER_URL: "https://hub.test",
          GITHUB_RUN_ID: "99",
          GITHUB_STEP_SUMMARY: summary,
        },
        fetch,
        sleep,
        log: (line) => lines.push(line),
        now: () => NOW,
      });

      assert.equal(code, 1);
      assert.ok(lines.includes("Monitor issue #13: opened."));
      assert.ok(
        lines.includes("::error title=Monitor · Faucet balance::0.0000 AVAX, under 1 AVAX"),
      );
      const opened = calls.find((call) => call.method === "POST" && call.url === `${api}/issues`);
      assert.match(
        opened.body.body,
        /\[this run\]\(https:\/\/hub\.test\/o\/r\/actions\/runs\/99\)/,
      );
      assert.match(readFileSync(summary, "utf8"), /^## Monitor\n\n\| Check \| Result \| Detail \|/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function lowFaucetRoutes() {
  return { [`${TARGETS.faucet}/health`]: { json: healthyFaucet({ balance: "1", low: true }) } };
}

function targetEnv() {
  return {
    MONITOR_SITE_URL: TARGETS.site,
    MONITOR_FAUCET_URL: TARGETS.faucet,
    MONITOR_TELEMETRY_URL: TARGETS.telemetry,
  };
}
