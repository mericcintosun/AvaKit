// Tripwires for .github/dependabot.yml and the three security workflows
// (codeql.yml, secret-scan.yml, scorecard.yml). ci.yml and release.yml have
// their own in scripts/workflows.test.mjs.
//
// Read as text, not parsed: the repo has no YAML dependency, and these files
// are short. If you restructure one, keep what it guarantees and update the
// test with it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A repository file as text, with CRLF line endings normalised. */
function read(...path) {
  return readFileSync(join(root, ...path), "utf8").replace(/\r\n/g, "\n");
}

// ---------------------------------------------------------------------------
// .github/dependabot.yml

const dependabot = read(".github", "dependabot.yml");

/** Each entry under `updates:`, as the text from its `  - package-ecosystem:` line on. */
const updates = dependabot.split(/^(?= {2}- package-ecosystem:)/m).slice(1);

/** The groups of an entry: `[{ name, types }]`, `types` being its update-types (or null). */
function groupsOf(entry) {
  const block = entry.match(/^ {4}groups:\n((?: {6,}.*\n|\s*\n)*)/m)?.[1] ?? "";
  return [...block.matchAll(/^ {6}([\w-]+):\n((?: {8,}.*\n|\s*\n)*)/gm)].map(([, name, body]) => {
    const list = body.match(/^ {8}update-types:\n((?: {10}- .*\n)+)/m)?.[1];
    const types = list ? [...list.matchAll(/^ {10}- (\S+)/gm)].map((m) => m[1]) : null;
    return { name, types };
  });
}

test("dependabot.yml never bundles a major update with minor and patch updates", () => {
  assert.ok(updates.length > 0, "dependabot.yml has no `updates:` entries");
  for (const entry of updates) {
    const ecosystem = entry.match(/package-ecosystem: (\S+)/)[1];
    for (const { name, types } of groupsOf(entry)) {
      // A group without update-types takes every update, majors included.
      assert.ok(types, `group \`${name}\` (${ecosystem}) must list its update-types`);
      if (types.includes("major")) {
        assert.deepEqual(types, ["major"], `group \`${name}\` mixes major with minor or patch`);
      }
    }
  }
});

test("dependabot.yml lets the Workers' entry update every Worker dependency and nothing else", () => {
  const services = updates.find((entry) => entry.includes('- "/services/faucet"'));
  assert.ok(services, "dependabot.yml has no entry for /services/faucet");
  const allowed = [
    ...(services.match(/^ {4}allow:\n((?: {6,}.*\n)+)/m)?.[1] ?? "").matchAll(
      /^ {6}- dependency-name: (\S+)/gm,
    ),
  ]
    .map((m) => m[1])
    .sort();
  const deps = new Set();
  for (const service of ["faucet", "telemetry"]) {
    const pkg = JSON.parse(read("services", service, "package.json"));
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) deps.add(name);
  }
  assert.deepEqual(
    allowed,
    [...deps].sort(),
    "the allow list of the services entry must name exactly the Workers' dependencies",
  );
});

test("dependabot.yml waits the same number of days in every entry", () => {
  const days = [...dependabot.matchAll(/^ {6}default-days: (\d+)\s*$/gm)].map((m) => Number(m[1]));
  assert.equal(days.length, updates.length, "every entry must set cooldown.default-days");
  assert.equal(new Set(days).size, 1, `the entries wait different numbers of days: ${days}`);
});

const workspace = read("pnpm-workspace.yaml");
const releaseAge = workspace.match(/^minimumReleaseAge: (\d+)\s*$/m)?.[1];

test("pnpm-workspace.yaml refuses releases younger than the Dependabot cooldown, no more", {
  skip: releaseAge ? false : "pnpm-workspace.yaml sets no minimumReleaseAge",
}, () => {
  // Dependabot runs pnpm with its cooldown as the minimum release age; a
  // shorter gate here lets a bump by hand pin a version that pnpm then
  // refuses to resolve in Dependabot's run.
  const days = Number(dependabot.match(/^ {6}default-days: (\d+)\s*$/m)[1]);
  assert.equal(Number(releaseAge), days * 24 * 60, "minimumReleaseAge is in minutes");
});

// ---------------------------------------------------------------------------
// .github/workflows/codeql.yml, secret-scan.yml, scorecard.yml

const security = Object.fromEntries(
  ["codeql.yml", "secret-scan.yml", "scorecard.yml"].map((name) => [
    name,
    read(".github", "workflows", name),
  ]),
);

/** The text of each job of a workflow by job id. */
function jobsOf(text) {
  const rest = text.slice(text.search(/^jobs:\n/m) + "jobs:\n".length);
  const next = rest.search(/^\S/m);
  const body = next === -1 ? rest : rest.slice(0, next);
  const heads = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):\n/gm)];
  return new Map(
    heads.map((head, i) => [head[1], body.slice(head.index, heads[i + 1]?.index ?? body.length)]),
  );
}

test("the security workflows pin every action, time out, and keep the token minimal", () => {
  for (const [name, text] of Object.entries(security)) {
    assert.match(
      text,
      /^permissions:(?: \{\}\n|\n {2}contents: read\n(?! ))/m,
      `${name} must set \`permissions: {}\` or \`permissions: contents: read\` at the top level`,
    );
    const jobs = jobsOf(text);
    assert.ok(jobs.size > 0, `${name} has no jobs`);
    for (const [id, job] of jobs) {
      assert.match(job, /^ {4}timeout-minutes: \d+\s*$/m, `${name}: job \`${id}\` has no timeout`);
    }
    for (const [, action] of text.matchAll(/^\s+(?:- )?uses: (.+)$/gm)) {
      assert.match(
        action.trim(),
        /^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\S+$/,
        `${name}: \`${action.trim()}\` must be pinned to a full commit SHA with its version`,
      );
    }
    const checkouts = text.match(/uses: actions\/checkout@/g)?.length ?? 0;
    const dropped = text.match(/^\s+persist-credentials: false\s*$/gm)?.length ?? 0;
    assert.equal(dropped, checkouts, `${name}: every checkout must set persist-credentials: false`);
  }
});

test("CodeQL analyses the TypeScript and JavaScript and the workflows", () => {
  const codeql = security["codeql.yml"];
  assert.match(codeql, /^ {10}- actions\s*$/m);
  assert.match(codeql, /^ {10}- javascript-typescript\s*$/m);
  assert.match(codeql, /^ {6}security-events: write\s*$/m, "the results go to code scanning");
});

test("the secret scan reads the full history with a pinned, checksum-verified gitleaks", () => {
  const scan = security["secret-scan.yml"];
  assert.match(scan, /^\s+fetch-depth: 0\s*$/m, "the checkout must fetch the full history");
  assert.match(scan, /^\s+GITLEAKS_VERSION: \d+\.\d+\.\d+\s*$/m);
  assert.match(scan, /^\s+GITLEAKS_SHA256: [0-9a-f]{64}\s*$/m);
  // Matched on script lines only (indented, not comments).
  assert.match(
    scan,
    /^\s+echo .* \| sha256sum --check --strict$/m,
    "the download must be checked before it runs",
  );
  assert.match(scan, /^\s+gitleaks git --redact /m, "findings must not print the secret");
});

test("the Scorecard workflow keeps the rules the Scorecard API checks before it accepts results", () => {
  const scorecard = security["scorecard.yml"];
  assert.doesNotMatch(scorecard, /^(env|defaults):/m, "no top-level env or defaults");
  assert.match(scorecard, /^permissions: \{\}\s*$/m, "no write permission at the top level");
  const analysis = jobsOf(scorecard).get("analysis");
  assert.ok(analysis, "scorecard.yml has no `analysis` job");
  assert.doesNotMatch(analysis, /^\s+(- )?run:/m, "the analysis job may not have run steps");
  assert.doesNotMatch(analysis, /^ {4}(env|defaults|container|services):/m);
  for (const [, action] of analysis.matchAll(/uses: ([\w.-]+\/[\w./-]+)@/g)) {
    assert.ok(
      [
        "actions/checkout",
        "actions/upload-artifact",
        "github/codeql-action/upload-sarif",
        "ossf/scorecard-action",
        "step-security/harden-runner",
      ].includes(action),
      `the Scorecard API does not accept results from a job that uses ${action}`,
    );
  }
  assert.match(scorecard, /^\s+publish_results: true\s*$/m);
});
