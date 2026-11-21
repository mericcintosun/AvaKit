// What scripts/flaky-hunt.mjs and .github/workflows/flaky-hunt.yml must not get
// wrong: every run gets a seed of its own and says which; a failure is reported
// with that seed and a command that replays it; the suites run with telemetry
// off; and in the workflow, only the job that files the issue can write.
//
// The end-to-end tests run the hunt against a fake package whose "Vitest" is a
// stub that writes down how it was started and answers with a canned report,
// so no real suite runs here.

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  discoverPackages,
  failuresFromReport,
  firstLine,
  hunt,
  newSeed,
  parseArgs,
  renderFailures,
  renderSummary,
  replayCommand,
  selectPackages,
  UsageError,
  vitestArgs,
  writeReports,
} from "./flaky-hunt.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MACHINE = { node: "v24.0.0", platform: "linux", arch: "x64", cpus: 4 };
const OPTIONS = { rounds: 2, parallel: false, load: 0, coverage: false, packages: [], out: null };

function tempDir(t) {
  // realpath: on macOS the temporary directory is reached through a symlink,
  // and the paths the stub reports back are resolved ones.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "avakit-flaky-hunt-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("parseArgs: defaults, every option, and refusals", () => {
  assert.deepEqual(parseArgs([]), { ...OPTIONS, rounds: 5 });
  assert.deepEqual(
    parseArgs([
      "--rounds",
      "3",
      "--parallel",
      "--load",
      "2",
      "--coverage",
      "--package",
      "a",
      "--package",
      "b",
    ]),
    { rounds: 3, parallel: true, load: 2, coverage: true, packages: ["a", "b"], out: null },
  );
  assert.equal(parseArgs(["--load", "auto"], { cpus: 7 }).load, 7);
  assert.equal(parseArgs(["--out", "x"]).out, join(process.cwd(), "x"));

  for (const argv of [
    ["--rounds", "0"],
    ["--rounds", "-1"],
    ["--rounds", "two"],
    ["--rounds", "1.5"],
    ["--rounds"],
    ["--load", "--parallel"],
    ["--package"],
    ["--shuffle"],
  ]) {
    assert.throws(() => parseArgs(argv), UsageError, argv.join(" "));
  }
});

test("discoverPackages finds the Vitest packages, and which of them measure coverage", (t) => {
  const dir = tempDir(t);
  const pkg = (name, test) => {
    mkdirSync(join(dir, "packages", name), { recursive: true });
    writeFileSync(
      join(dir, "packages", name, "package.json"),
      JSON.stringify({ name, scripts: test === undefined ? {} : { test } }),
    );
  };
  pkg("b-measured", "vitest run --coverage");
  pkg("a-plain", "vitest run");
  pkg("node-test", "node --test");
  pkg("no-tests");
  pkg("look-alike", "vitest-something run --coverage-report");
  mkdirSync(join(dir, "packages", "no-manifest"));

  assert.deepEqual(discoverPackages(dir), [
    { name: "a-plain", dir: join(dir, "packages", "a-plain"), coverage: false },
    { name: "b-measured", dir: join(dir, "packages", "b-measured"), coverage: true },
  ]);
});

test("in this repository, the hunt covers every published package", () => {
  assert.deepEqual(
    discoverPackages(root).map((pkg) => pkg.name),
    ["@avakit/core", "@avakit/mcp", "@avakit/react", "@avakit/studio", "create-avalanche-app"],
  );
});

test("selectPackages keeps the order asked for and names the choices on a typo", () => {
  const available = [
    { name: "a", dir: "/a", coverage: false },
    { name: "b", dir: "/b", coverage: true },
  ];
  assert.deepEqual(selectPackages(available, []), available);
  assert.deepEqual(
    selectPackages(available, ["b", "a"]).map((pkg) => pkg.name),
    ["b", "a"],
  );
  assert.throws(() => selectPackages(available, ["c"]), /choose from a, b/);
});

test("newSeed never hands out a seed twice", () => {
  const draws = [5, 5, 5, 7, 5, 9];
  const used = new Set();
  const draw = () => draws.shift();
  assert.deepEqual([newSeed(used, draw), newSeed(used, draw), newSeed(used, draw)], [5, 7, 9]);
  const seed = newSeed(new Set());
  assert.ok(Number.isInteger(seed) && seed >= 1 && seed < 2 ** 31, String(seed));
});

test("vitestArgs shuffles files and tests under the seed, and measures coverage only when asked", () => {
  const args = vitestArgs({ seed: 42, reportFile: "/out/r.json", coverage: false });
  assert.deepEqual(args, [
    "run",
    "--sequence.shuffle",
    "--sequence.seed=42",
    "--reporter=default",
    "--reporter=json",
    "--outputFile.json=/out/r.json",
  ]);
  assert.ok(vitestArgs({ seed: 1, reportFile: "r", coverage: true }).includes("--coverage"));
});

test("replayCommand runs the same seed, for one file or the whole suite", () => {
  assert.equal(
    replayCommand("@avakit/react", 7, "src/a.test.tsx"),
    "pnpm --filter @avakit/react exec vitest run --sequence.shuffle --sequence.seed=7 src/a.test.tsx",
  );
  assert.equal(
    replayCommand("@avakit/react", 7),
    "pnpm --filter @avakit/react exec vitest run --sequence.shuffle --sequence.seed=7",
  );
});

test("failuresFromReport names each failing test, and a file that failed outside its tests", () => {
  const report = {
    testResults: [
      {
        name: "/pkg/src/ok.test.ts",
        status: "passed",
        assertionResults: [{ status: "passed", ancestorTitles: [], title: "fine" }],
      },
      {
        name: "/pkg/src/two-chains.test.tsx",
        status: "failed",
        assertionResults: [
          { status: "passed", ancestorTitles: ["x"], title: "fine" },
          {
            status: "failed",
            ancestorTitles: ["burner wallet across two chains"],
            title: "sends on the second chain",
            failureMessages: [
              "\u001b[31mAssertionError: expected 'icm1' to be 'icm2'\u001b[39m\n    at stack",
            ],
          },
        ],
      },
      { name: "/pkg/src/broken.test.ts", status: "failed", message: "\n\nSyntaxError: nope\n" },
    ],
  };
  assert.deepEqual(failuresFromReport(report, "/pkg"), [
    {
      file: "src/two-chains.test.tsx",
      test: "burner wallet across two chains › sends on the second chain",
      message: "AssertionError: expected 'icm1' to be 'icm2'",
    },
    {
      file: "src/broken.test.ts",
      test: "(the file failed outside its tests)",
      message: "SyntaxError: nope",
    },
  ]);
  assert.deepEqual(failuresFromReport(null, "/pkg"), []);
  assert.equal(firstLine("x".repeat(400)).length, 300);
});

function failedRun(overrides = {}) {
  return {
    package: "@avakit/react",
    round: 2,
    seed: 1234,
    ok: false,
    tests: 10,
    failures: [{ file: "src/a.test.tsx", test: "a › b", message: "Error: has ``` inside" }],
    crash: null,
    durationMs: 1500,
    log: "/out/round-2-avakit-react.log",
    ...overrides,
  };
}

test("renderFailures gives the seed, the failing test and the command that replays it", () => {
  const passed = { ...failedRun(), ok: true, failures: [], package: "@avakit/core" };
  assert.equal(renderFailures([passed], OPTIONS, MACHINE), "");

  const text = renderFailures([passed, failedRun()], OPTIONS, MACHINE);
  assert.match(text, /\*\*@avakit\/react\*\*, round 2, seed `1234`/);
  assert.match(text, /- `src\/a\.test\.tsx` › a › b/);
  assert.ok(text.includes(replayCommand("@avakit/react", 1234, "src/a.test.tsx")));
  assert.doesNotMatch(text, /@avakit\/core/);
  // A message with a fence in it cannot close its own code block early.
  assert.match(text, /````text\nError: has ``` inside\n````/);
  assert.match(text, /one package at a time, no extra load \(Node v24\.0\.0, linux x64, 4 CPUs\)/);

  const crashed = failedRun({
    failures: [],
    crash: { file: null, test: "(the run failed outside any test, exit status 1)", message: "x" },
  });
  const crashText = renderFailures([crashed], OPTIONS, MACHINE);
  assert.match(crashText, /- \(the run failed outside any test, exit status 1\)/);
  assert.ok(crashText.includes(replayCommand("@avakit/react", 1234)));
});

test("renderFailures lists at most 40 failures and counts the rest", () => {
  const failures = Array.from({ length: 45 }, (_, i) => ({
    file: `src/t${i}.test.ts`,
    test: `test ${i}`,
    message: "boom",
  }));
  const text = renderFailures([failedRun({ failures })], OPTIONS, MACHINE);
  assert.equal(text.match(/^- /gm).length, 40);
  assert.match(text, /And 5 more failure\(s\)/);
});

test("renderSummary has one row per run", () => {
  const passed = { ...failedRun(), ok: true, failures: [], round: 1 };
  const text = renderSummary([passed, failedRun()], OPTIONS, MACHINE);
  assert.match(text, /2 runs, 1 failed\./);
  assert.match(text, /\| 1 \| @avakit\/react \| 1234 \| passed \(10 tests\) \| 1\.5 s \|/);
  assert.match(text, /\| 2 \| @avakit\/react \| 1234 \| \*\*1 failed\*\* \| 1\.5 s \|/);
});

// A stand-in for Vitest: it records how it was started, then writes the JSON
// report it was asked for. FAKE_VITEST_MODE picks the outcome: "pass", "fail"
// (one failing test) or "crash" (exit 1 with no report, like a config error).
const STUB_VITEST = `
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_VITEST_RECORD, JSON.stringify({
  args,
  cwd: process.cwd(),
  telemetryDisabled: process.env.AVAKIT_TELEMETRY_DISABLED ?? null,
  doNotTrack: process.env.DO_NOT_TRACK ?? null,
}) + "\\n");
const mode = process.env.FAKE_VITEST_MODE;
if (mode === "crash") {
  console.error("Error: failed to load config");
  process.exit(1);
}
const report = args.find((arg) => arg.startsWith("--outputFile.json=")).slice(18);
const failed = mode === "fail";
writeFileSync(report, JSON.stringify({
  numTotalTests: 2,
  testResults: [{
    name: join(process.cwd(), "src", "a.test.ts"),
    status: failed ? "failed" : "passed",
    assertionResults: [
      { status: "passed", ancestorTitles: ["suite"], title: "steady" },
      {
        status: failed ? "failed" : "passed",
        ancestorTitles: ["suite"],
        title: "racy",
        failureMessages: failed ? ["AssertionError: expected 1 to be 2"] : [],
      },
    ],
  }],
}));
process.exit(failed ? 1 : 0);
`;

function fakeWorkspace(t, names = ["fake-a", "fake-b"]) {
  const dir = tempDir(t);
  const packages = names.map((name) => {
    const pkgDir = join(dir, "packages", name);
    mkdirSync(join(pkgDir, "node_modules", "vitest"), { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name, scripts: { test: "vitest run --coverage" } }),
    );
    writeFileSync(join(pkgDir, "node_modules", "vitest", "vitest.mjs"), STUB_VITEST);
    return { name, dir: pkgDir, coverage: true };
  });
  const out = join(dir, "out");
  mkdirSync(out);
  const record = join(dir, "record.jsonl");
  writeFileSync(record, "");
  return { packages, out, record };
}

function withEnv(t, values) {
  const saved = {};
  for (const [name, value] of Object.entries(values)) {
    saved[name] = process.env[name];
    process.env[name] = value;
  }
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

function recorded(record) {
  return readFileSync(record, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("hunt runs every package every round, each run with a seed of its own and telemetry off", async (t) => {
  const { packages, out, record } = fakeWorkspace(t);
  withEnv(t, {
    FAKE_VITEST_RECORD: record,
    FAKE_VITEST_MODE: "pass",
    AVAKIT_TELEMETRY_DISABLED: "",
    DO_NOT_TRACK: "",
  });
  const printed = [];
  const runs = await hunt({ ...OPTIONS, rounds: 3, parallel: true }, packages, {
    out,
    print: (text) => printed.push(text),
  });

  assert.equal(runs.length, 6);
  assert.ok(runs.every((run) => run.ok && run.tests === 2));
  assert.deepEqual(
    runs.map((run) => `${run.round}:${run.package}`),
    ["1:fake-a", "1:fake-b", "2:fake-a", "2:fake-b", "3:fake-a", "3:fake-b"],
  );
  assert.equal(new Set(runs.map((run) => run.seed)).size, 6, "six runs, six seeds");

  const starts = recorded(record);
  assert.equal(starts.length, 6);
  for (const start of starts) {
    const seed = Number(start.args.find((arg) => arg.startsWith("--sequence.seed=")).slice(16));
    const run = runs.find((candidate) => candidate.seed === seed);
    assert.ok(run, `a run was reported for seed ${seed}`);
    assert.equal(start.cwd, packages.find((pkg) => pkg.name === run.package).dir);
    assert.deepEqual(start.args.slice(0, 2), ["run", "--sequence.shuffle"]);
    // --coverage was not asked for, even though the package's script measures it.
    assert.ok(!start.args.includes("--coverage"));
    assert.equal(start.telemetryDisabled, "1");
    assert.equal(start.doNotTrack, "1");
  }
  // Every seed was printed before its run started.
  for (const run of runs) {
    assert.ok(
      printed.some((line) =>
        line.includes(`start   round ${run.round}/3 · ${run.package} · seed ${run.seed}`),
      ),
    );
  }
});

test("hunt measures coverage only in a package whose test script does", async (t) => {
  const { packages, out, record } = fakeWorkspace(t);
  withEnv(t, { FAKE_VITEST_RECORD: record, FAKE_VITEST_MODE: "pass" });
  const mixed = [packages[0], { ...packages[1], coverage: false }];
  await hunt({ ...OPTIONS, rounds: 1, coverage: true }, mixed, { out });
  const byDir = Object.fromEntries(recorded(record).map((start) => [start.cwd, start.args]));
  assert.ok(byDir[packages[0].dir].includes("--coverage"));
  assert.ok(!byDir[packages[1].dir].includes("--coverage"));
});

test("a failing run is reported with its seed, its test and the command that replays it", async (t) => {
  const { packages, out, record } = fakeWorkspace(t, ["fake-a"]);
  withEnv(t, { FAKE_VITEST_RECORD: record, FAKE_VITEST_MODE: "fail" });
  const runs = await hunt({ ...OPTIONS, rounds: 2 }, packages, { out });
  writeReports(runs, OPTIONS, MACHINE, out);

  assert.ok(runs.every((run) => !run.ok));
  const failures = JSON.parse(readFileSync(join(out, "failures.json"), "utf8"));
  assert.deepEqual(
    failures.map((entry) => entry.seed),
    runs.map((run) => run.seed),
  );
  assert.deepEqual(failures[0].failures, [
    { file: "src/a.test.ts", test: "suite › racy", message: "AssertionError: expected 1 to be 2" },
  ]);
  const markdown = readFileSync(join(out, "failures.md"), "utf8");
  for (const run of runs) {
    assert.ok(markdown.includes(replayCommand("fake-a", run.seed, "src/a.test.ts")));
  }
  // Each run left its log and its JSON report behind.
  const files = readdirSync(out).sort();
  for (const name of ["round-1-fake-a.json", "round-1-fake-a.log", "round-2-fake-a.log"]) {
    assert.ok(files.includes(name), `${name} in ${files.join(", ")}`);
  }
});

test("a run that ends without a report is a failure, with the end of its log", async (t) => {
  const { packages, out, record } = fakeWorkspace(t, ["fake-a"]);
  withEnv(t, { FAKE_VITEST_RECORD: record, FAKE_VITEST_MODE: "crash" });
  const [run] = await hunt({ ...OPTIONS, rounds: 1 }, packages, { out });
  writeReports([run], OPTIONS, MACHINE, out);

  assert.equal(run.ok, false);
  assert.deepEqual(run.failures, []);
  assert.equal(run.crash.test, "(the run failed outside any test, exit status 1)");
  assert.match(run.crash.message, /failed to load config/);
  assert.match(readFileSync(join(out, "failures.md"), "utf8"), /failed to load config/);
});

test("when every run passes, there is no failures.md and failures.json is empty", async (t) => {
  const { packages, out, record } = fakeWorkspace(t, ["fake-a"]);
  withEnv(t, { FAKE_VITEST_RECORD: record, FAKE_VITEST_MODE: "pass" });
  const runs = await hunt({ ...OPTIONS, rounds: 1 }, packages, { out });
  writeReports(runs, OPTIONS, MACHINE, out);
  assert.deepEqual(JSON.parse(readFileSync(join(out, "failures.json"), "utf8")), []);
  assert.ok(!readdirSync(out).includes("failures.md"));
  assert.match(readFileSync(join(out, "summary.md"), "utf8"), /1 run, 0 failed\./);
});

// The workflow, read as text like scripts/workflows.test.mjs reads release.yml.
const workflow = readFileSync(join(root, ".github", "workflows", "flaky-hunt.yml"), "utf8").replace(
  /\r\n/g,
  "\n",
);
/** The workflow's jobs, by id, each as the text of its block. */
const jobs = Object.fromEntries(
  workflow
    .split(/^jobs:\n/m)[1]
    .split(/^(?= {2}[a-z][\w-]*:\n)/m)
    .map((block) => [block.match(/^ {2}([a-z][\w-]*):/)[1], block]),
);

test("flaky-hunt.yml: read-only by default, and only the report job writes, to issues", () => {
  assert.match(workflow, /^permissions:\n {2}contents: read\n\n/m);
  assert.deepEqual(Object.keys(jobs).sort(), ["hunt", "report"]);
  assert.match(jobs.hunt, /^ {4}permissions:\n {6}contents: read\n {4}strategy:/m);
  assert.doesNotMatch(jobs.hunt, /: write$/m);
  assert.match(
    jobs.report,
    /^ {4}permissions:\n {6}contents: read\n {6}issues: write\n {4}steps:/m,
  );
  // The job that can write runs no code from the repository or its dependencies.
  assert.doesNotMatch(jobs.report, /actions\/checkout|pnpm|npm |node /);
});

test("flaky-hunt.yml: every job has a time limit and every action is pinned to a commit", () => {
  for (const [id, block] of Object.entries(jobs)) {
    assert.match(block, /^ {4}timeout-minutes: \d+$/m, `${id} has timeout-minutes`);
  }
  const uses = [...workflow.matchAll(/^\s+uses: (\S+)(.*)$/gm)];
  assert.ok(uses.length >= 5);
  for (const [, action, comment] of uses) {
    assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${action} is pinned to a SHA`);
    assert.match(comment, /^ # v\d/, `${action} names its version`);
  }
});

test("flaky-hunt.yml: hunts nightly and on demand, and reports only a failed hunt", () => {
  assert.match(workflow, /^ {2}schedule:\n {4}# .*\n {4}- cron: "[^"]+"$/m);
  assert.match(workflow, /^ {2}workflow_dispatch:$/m);
  assert.match(jobs.hunt, /run: node scripts\/flaky-hunt\.mjs --rounds "\$ROUNDS" \$FLAGS --out/);
  assert.match(jobs.hunt, /flags: --parallel --load auto --coverage/);
  assert.match(
    jobs.report,
    /^ {4}needs: hunt\n {4}if: always\(\) && needs\.hunt\.result == 'failure'$/m,
  );
  assert.match(jobs.report, /--label flaky-test/);
});
