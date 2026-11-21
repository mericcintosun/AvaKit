// Tripwires for .github/dependabot.yml, the three security workflows
// (codeql.yml, secret-scan.yml, scorecard.yml) and .gitleaks.toml, and for
// the name of the one check the main branch ruleset requires. ci.yml and
// release.yml have their own in scripts/workflows.test.mjs.
//
// Read as text, not parsed: the repo has no YAML or TOML dependency, and these
// files are short. If you restructure one, keep what it guarantees and update
// the test with it.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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
const workspace = read("pnpm-workspace.yaml");

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

/** The Workers' entry of dependabot.yml. */
function servicesEntry() {
  const services = updates.find((entry) => entry.includes('- "/services/faucet"'));
  assert.ok(services, "dependabot.yml has no entry for /services/faucet");
  return services;
}

/** The `ignore` rules of an entry: `[{ name, versions }]`, `versions` being null when it has none. */
function ignoresOf(entry) {
  const block = entry.match(/^ {4}ignore:\n((?: {6,}.*\n|\s*\n)*)/m)?.[1] ?? "";
  return block
    .split(/^(?= {6}- dependency-name:)/m)
    .slice(1)
    .map((rule) => ({
      name: rule.match(/^ {6}- dependency-name: "?([^"\s]+)"?/)[1],
      versions: rule.match(/^ {8}versions:\n((?: {10}- .*\n)+)/m)?.[1]
        ? [...rule.matchAll(/^ {10}- "?([^"\n]+?)"?\s*$/gm)].map((m) => m[1])
        : null,
    }));
}

test("dependabot.yml keeps the security updates of every package in the Workers' lockfiles", () => {
  // An `allow` list limits the security updates as well as the version
  // updates: every package of the Workers' lockfiles it did not name (the
  // trees under wrangler and viem) would get no security update.
  assert.doesNotMatch(
    servicesEntry(),
    /^ {4}allow:/m,
    "the services entry must not have an allow list",
  );
});

test("dependabot.yml leaves the workspace catalog to the workspace entry", () => {
  // From /services/* Dependabot also reads the root pnpm-workspace.yaml and
  // tries to update its catalog with pnpm, which fails the run.
  const catalog = workspace.match(/^catalog:\n((?: {2}.*\n|\s*\n)*)/m)?.[1];
  assert.ok(catalog, "pnpm-workspace.yaml has no catalog");
  const keys = [...catalog.matchAll(/^ {2}"?([^":\s]+)"?:/gm)].map((m) => m[1]);
  assert.ok(keys.length > 0, "the catalog has no entries");
  const ignored = new Map(ignoresOf(servicesEntry()).map((rule) => [rule.name, rule]));
  for (const key of keys) {
    assert.ok(ignored.has(key), `the services entry must ignore the catalog's ${key}`);
    assert.equal(
      ignored.get(key).versions,
      null,
      `the services entry must ignore every version of ${key}`,
    );
  }
});

test("dependabot.yml holds the faucet's viem back only while the faucet pins an older viem", () => {
  const rule = ignoresOf(servicesEntry()).find((r) => r.name === "viem");
  if (!rule) return;
  // The rule is `>=<first version the faucet cannot take>`. Once the faucet
  // moves past it, the rule only stops the faucet's updates: remove it with
  // the pin.
  const floor =
    rule.versions?.length === 1 ? rule.versions[0].match(/^>=(\d+\.\d+\.\d+)$/)?.[1] : null;
  assert.ok(floor, "the viem rule must be a single `>=x.y.z` range");
  const pin = JSON.parse(read("services", "faucet", "package.json")).dependencies?.viem;
  assert.match(
    pin ?? "",
    /^\d+\.\d+\.\d+$/,
    "the faucet must pin viem exactly while the rule exists",
  );
  const [pinned, held] = [pin, floor].map((version) => version.split(".").map(Number));
  const order = pinned[0] - held[0] || pinned[1] - held[1] || pinned[2] - held[2];
  assert.ok(
    order < 0,
    `the faucet pins viem ${pin}, inside the held-back range >=${floor}: remove the rule`,
  );
});

test("dependabot.yml waits the same number of days in every entry", () => {
  const days = [...dependabot.matchAll(/^ {6}default-days: (\d+)\s*$/gm)].map((m) => Number(m[1]));
  assert.equal(days.length, updates.length, "every entry must set cooldown.default-days");
  assert.equal(new Set(days).size, 1, `the entries wait different numbers of days: ${days}`);
});

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
  // The whole command, so no flag can narrow it: no `-1` or other limit in
  // --log-opts, no --exit-code 0, no other config, baseline or ignore file.
  // Findings never print the secret (--redact).
  assert.match(
    scan,
    /^ {10}gitleaks git --redact --no-banner --verbose --log-opts="--full-history \$\{SCOPE\}" \.$/m,
    "the scan must read the full history of SCOPE, with no flag that narrows it",
  );
  assert.match(
    scan,
    /^ {10}SCOPE: \$\{\{ \(github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'\) && '--all' \|\| 'HEAD' \}\}$/m,
    "SCOPE must be the commit under test, or every branch and tag on the weekly and hand-started runs",
  );
});

test("nothing in the secret scan lets a finding pass", () => {
  const scan = security["secret-scan.yml"];
  // Lines that are not comments.
  const code = scan
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  assert.doesNotMatch(code, /continue-on-error/, "no job or step may continue on error");
  assert.doesNotMatch(code, /^\s+if:/m, "no job or step may be conditional");
  assert.doesNotMatch(code, /--exit-code[ =]0\b/, "a finding must fail the scan");
  // GITLEAKS_CONFIG or GITLEAKS_CONFIG_TOML would replace .gitleaks.toml.
  assert.doesNotMatch(code, /GITLEAKS_CONFIG/, "the scan must read .gitleaks.toml");
});

test("the secret scan checks first that .gitleaks.toml still finds a planted key", () => {
  const scan = security["secret-scan.yml"];
  // Script lines (indented ten spaces), not the comments that quote them.
  const canary = scan.search(/^ {10}gitleaks dir .*--config \.gitleaks\.toml --exit-code 99 /m);
  assert.notEqual(
    canary,
    -1,
    "the planted-key step must scan with .gitleaks.toml and --exit-code 99",
  );
  assert.ok(canary < scan.search(/^ {10}gitleaks git /m), "it must run before the scan");
  assert.match(scan, /^ {10}printf 'api_key = "%s"\\n' "\$\(openssl rand -hex 32\)" > /m);
  assert.match(
    scan,
    /^ {10}if \[ "\$status" -ne 99 \]; then$/m,
    "only exit code 99 means it was found",
  );
});

// ---------------------------------------------------------------------------
// .gitleaks.toml

/** The tables of .gitleaks.toml, `[{ header, body }]`, comments and blank lines left out. */
const gitleaksTables = read(".gitleaks.toml")
  .split("\n")
  .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
  .join("\n")
  .split(/^(?=\[)/m)
  .filter((table) => table.startsWith("["))
  .map((table) => {
    const [header, ...body] = table.split("\n");
    return { header, body: body.join("\n").trim() };
  });

test(".gitleaks.toml extends the default rules instead of replacing them", () => {
  // Without useDefault the file replaces the default rules, and the scan
  // finds nothing at all. disabledRules would switch one of them off.
  const extend = gitleaksTables.filter((t) => t.header === "[extend]");
  assert.equal(extend.length, 1, ".gitleaks.toml must have one [extend] table");
  assert.equal(
    extend[0].body,
    "useDefault = true",
    "[extend] must be `useDefault = true` and nothing else",
  );
});

/** The TOML literal strings ('''...''') of an array value `key = [...]` in a table body. */
function literalsOf(body, key) {
  const array = body.match(new RegExp(`^${key} = \\[([\\s\\S]*?)\\]$`, "m"))?.[1] ?? "";
  return [...array.matchAll(/'''(.*?)'''/g)].map((m) => m[1]);
}

/** A gitleaks (Go) regex as a JavaScript one: these files use only syntax both read alike. */
function goRegex(source) {
  return source.startsWith("(?i)") ? new RegExp(source.slice(4), "i") : new RegExp(source);
}

test(".gitleaks.toml allows only exact values, or one kind of value in named files", () => {
  const allowlists = gitleaksTables.filter((t) => t.header === "[[allowlists]]");
  assert.ok(allowlists.length > 0, ".gitleaks.toml has no allowlists");
  const hex = (bytes) => randomBytes(bytes).toString("hex");
  for (const { body } of allowlists) {
    const description = body.match(/^description = "(.+)"$/m)?.[1];
    assert.ok(description, "every allowlist must say what it allows");
    assert.doesNotMatch(
      body,
      /^(commits|stopwords) =/m,
      `${description}: allow by value or path only`,
    );
    const regexes = literalsOf(body, "regexes");
    const paths = literalsOf(body, "paths");
    assert.ok(regexes.length > 0, `${description}: an allowlist must name the values it allows`);
    // A regex that is not anchored at both ends matches inside a longer value.
    for (const regex of [...regexes, ...paths]) {
      assert.match(
        regex,
        /^(\(\?i\))?\^.*\$$/,
        `${description}: \`${regex}\` must be anchored with ^ and $`,
      );
    }
    if (paths.length === 0) {
      // Allowed everywhere, so it must allow one value, not any key.
      for (const value of [hex(32), `0x${hex(32)}`, hex(20)]) {
        for (const regex of regexes) {
          assert.doesNotMatch(value, goRegex(regex), `${description}: \`${regex}\` allows any key`);
        }
      }
    } else {
      // Allowed in named files only: their path and the value must both match,
      // for the rule that misreads them.
      assert.match(
        body,
        /^condition = "AND"$/m,
        `${description}: a path allowlist needs condition AND`,
      );
      assert.match(
        body,
        /^targetRules = \[.+\]$/m,
        `${description}: a path allowlist must name its rules`,
      );
      for (const path of [".env", "packages/core/src/index.ts", "services/faucet/src/index.mjs"]) {
        for (const regex of paths) {
          assert.doesNotMatch(path, goRegex(regex), `${description}: \`${regex}\` allows ${path}`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The "CI passed" check

test('only ci.yml names a job "CI passed", the check the main branch ruleset requires', () => {
  // Another job of that name, in any workflow, would report the same check,
  // and a pull request could pass the ruleset on its result.
  const dir = join(root, ".github", "workflows");
  const named = readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .flatMap((name) =>
      [
        ...read(".github", "workflows", name).matchAll(
          /^[ \t]+name:[ \t]*["']?CI passed["']?[ \t]*$/gim,
        ),
      ].map(() => name),
    );
  assert.deepEqual(named, ["ci.yml"], `jobs named "CI passed": ${named.join(", ") || "none"}`);
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
