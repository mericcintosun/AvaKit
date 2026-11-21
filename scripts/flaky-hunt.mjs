#!/usr/bin/env node
/**
 * Hunt for flaky tests: run the workspace's Vitest suites again and again, in a
 * shuffled order and, when asked, on a busy machine, and report every test that
 * failed together with the seed that ordered its run.
 *
 *   node scripts/flaky-hunt.mjs [--rounds <n>] [--parallel] [--load <n|auto>]
 *                               [--coverage] [--package <name>]... [--out <dir>]
 *
 * --rounds <n>       How many times each suite runs. Default: 5. Every run gets a
 *                    new random seed, printed before the run starts.
 * --parallel         Start the suites of a round at the same time, the way
 *                    `pnpm test` does through Turborepo.
 * --load <n|auto>    Keep n busy-looping processes running meanwhile ("auto": one
 *                    per CPU), so the suites compete for the CPU as they do on a
 *                    small CI runner.
 * --coverage         Collect coverage as `pnpm test` does, in the packages whose
 *                    test script asks for it, thresholds included.
 * --package <name>   Hunt in this package only. Repeatable. Default: every package
 *                    under packages/ whose `test` script runs Vitest.
 * --out <dir>        Where to write each run's log and JSON report, summary.md,
 *                    failures.md and failures.json. Default: a new temporary
 *                    directory, printed at the end.
 *
 * Two kinds of flakiness show up here. A test that depends on the tests before
 * it (module state, a mock, a stubbed global or a fake timer left behind) fails
 * again with the same seed, which the report turns into a command that replays
 * it. A test that races its own asynchronous work (the React provider tests that
 * failed the release on 19 November 2026 raced the effects that register the
 * wallet listeners) fails only when the machine is busy: --parallel and --load
 * make it busy, and the same seed may well pass on an idle one. Neither kind is
 * fixed by retrying; find the race or the leak.
 *
 * Every run has a wall-clock limit of 15 minutes; a run that exceeds it is
 * stopped and counted as a failure. The suites run with AVAKIT_TELEMETRY_DISABLED=1
 * and DO_NOT_TRACK=1. Inside GitHub Actions the summary is also appended to
 * $GITHUB_STEP_SUMMARY.
 *
 * Exit status: 0 when every run passed, 1 when any failed, 2 for a usage error.
 *
 * Plain Node.js, no dependencies. The parts without side effects are exported
 * for scripts/flaky-hunt.test.mjs; importing this file runs nothing.
 */

import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Read through an alias, as scripts/e2e-fuji.mjs does: Biome's Turborepo rule
// asks for every variable read here to be declared in turbo.json, and this
// script is not a turbo task.
const ENV = process.env;

const DEFAULT_ROUNDS = 5;
const RUN_TIMEOUT_MS = 15 * 60 * 1000;
/** Failures listed in failures.md; the rest are counted and left to failures.json. */
const MAX_LISTED_FAILURES = 40;
/** Seeds stay below 2^31 so they read the same in every tool that parses them. */
const MAX_SEED = 2 ** 31 - 1;

export const USAGE = `Usage: node scripts/flaky-hunt.mjs [--rounds <n>] [--parallel] [--load <n|auto>]
                                  [--coverage] [--package <name>]... [--out <dir>]`;

export class UsageError extends Error {}

/** The options in `argv` (without node and the script), with their defaults filled in. */
export function parseArgs(argv, { cpus = os.availableParallelism() } = {}) {
  const options = {
    rounds: DEFAULT_ROUNDS,
    parallel: false,
    load: 0,
    coverage: false,
    packages: [],
    out: null,
  };
  const value = (flag, index) => {
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new UsageError(`${flag} needs a value`);
    }
    return next;
  };
  const count = (flag, text, { min }) => {
    if (!/^\d+$/.test(text) || Number(text) < min) {
      throw new UsageError(`${flag} must be a whole number of at least ${min}, not "${text}"`);
    }
    return Number(text);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--rounds":
        options.rounds = count(arg, value(arg, i), { min: 1 });
        i++;
        break;
      case "--parallel":
        options.parallel = true;
        break;
      case "--load": {
        const text = value(arg, i);
        options.load = text === "auto" ? cpus : count(arg, text, { min: 0 });
        i++;
        break;
      }
      case "--coverage":
        options.coverage = true;
        break;
      case "--package":
        options.packages.push(value(arg, i));
        i++;
        break;
      case "--out":
        options.out = path.resolve(value(arg, i));
        i++;
        break;
      case "--help":
      case "-h":
        throw new UsageError(USAGE);
      default:
        throw new UsageError(`unknown option "${arg}"\n${USAGE}`);
    }
  }
  return options;
}

/**
 * The packages under `<root>/packages` whose `test` script runs Vitest, as
 * `{ name, dir, coverage }`, sorted by name. `coverage` says whether that
 * script measures coverage (and so checks the package's thresholds).
 */
export function discoverPackages(root = REPO) {
  const packagesDir = path.join(root, "packages");
  const found = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(packagesDir, entry.name);
    const manifest = path.join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    const script = pkg.scripts?.test ?? "";
    if (/^vitest(\s|$)/.test(script)) {
      found.push({ name: pkg.name, dir, coverage: /(^|\s)--coverage(\s|$)/.test(script) });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** The packages to hunt in: all of `available`, or the ones `wanted` names. */
export function selectPackages(available, wanted) {
  if (wanted.length === 0) return available;
  return wanted.map((name) => {
    const pkg = available.find((candidate) => candidate.name === name);
    if (!pkg) {
      const names = available.map((candidate) => candidate.name).join(", ");
      throw new UsageError(`no package named "${name}" runs Vitest; choose from ${names}`);
    }
    return pkg;
  });
}

/** A seed in [1, 2^31 - 1] that is not in `used`, which it is added to. */
export function newSeed(used, draw = () => randomInt(1, MAX_SEED)) {
  for (;;) {
    const seed = draw();
    if (!used.has(seed)) {
      used.add(seed);
      return seed;
    }
  }
}

/** The arguments that run a package's suite in the order `seed` gives it. */
export function vitestArgs({ seed, reportFile, coverage }) {
  return [
    "run",
    "--sequence.shuffle",
    `--sequence.seed=${seed}`,
    "--reporter=default",
    "--reporter=json",
    `--outputFile.json=${reportFile}`,
    ...(coverage ? ["--coverage"] : []),
  ];
}

/** The command that replays a failure: the same seed, so the same order. */
export function replayCommand(packageName, seed, file) {
  const target = file ? ` ${file}` : "";
  return `pnpm --filter ${packageName} exec vitest run --sequence.shuffle --sequence.seed=${seed}${target}`;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

/** `text` without terminal colour codes. */
export function stripAnsi(text) {
  return text.replace(ANSI, "");
}

/** The first non-empty line of an error message, cut to a readable length. */
export function firstLine(message) {
  const line =
    stripAnsi(message ?? "")
      .split("\n")
      .map((part) => part.trim())
      .find((part) => part !== "") ?? "";
  return line.length > 300 ? `${line.slice(0, 297)}...` : line;
}

/**
 * The error line the default reporter printed under a failed test's heading
 * (` FAIL  <file> > <describe> > <test>`), or "" when the log has none.
 */
export function messageInLog(log, file, names) {
  const heading = `FAIL  ${[file, ...names].join(" > ")}`;
  const lines = stripAnsi(log).split("\n");
  const at = lines.findIndex((line) => line.trim() === heading);
  if (at === -1) return "";
  return firstLine(lines.slice(at + 1).join("\n"));
}

/**
 * The failures in a Vitest JSON report, as `{ file, test, message }` with `file`
 * relative to `packageDir`. A file that failed without a failing test (an error
 * while loading it, or in a hook outside any test) is one failure of its own.
 *
 * The message is the line the run's `log` shows under the test's heading when
 * there is one: the JSON report keeps only a stack for some errors, and for a
 * timeout that stack begins "Error: STACK_TRACE_ERROR", not with the timeout.
 */
export function failuresFromReport(report, packageDir, log = "") {
  const failures = [];
  for (const result of report?.testResults ?? []) {
    if (result.status !== "failed") continue;
    const file = path.relative(packageDir, result.name).split(path.sep).join("/");
    const failed = (result.assertionResults ?? []).filter(
      (assertion) => assertion.status === "failed",
    );
    for (const assertion of failed) {
      const names = [...(assertion.ancestorTitles ?? []), assertion.title];
      failures.push({
        file,
        test: names.join(" › "),
        message: messageInLog(log, file, names) || firstLine(assertion.failureMessages?.[0]),
      });
    }
    if (failed.length === 0) {
      failures.push({
        file,
        test: "(the file failed outside its tests)",
        message: firstLine(result.message),
      });
    }
  }
  return failures;
}

/** The last `count` non-empty lines of a log, without colour codes. */
export function tail(log, count = 15) {
  return stripAnsi(log)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .slice(-count)
    .join("\n");
}

/** A Markdown code fence that `text` cannot close early. */
function fenceFor(text) {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(longest + 1);
}

function codeBlock(text) {
  const fence = fenceFor(text);
  return `${fence}text\n${text}\n${fence}`;
}

function inlineCode(text) {
  const fence = text.includes("`") ? "``" : "`";
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** One line saying how the runs were made: order, concurrency, load and machine. */
export function describeMode(options, machine) {
  const parts = [
    `${options.rounds} round${options.rounds === 1 ? "" : "s"}`,
    "shuffled files and tests",
    options.parallel ? "packages at the same time" : "one package at a time",
    options.load > 0
      ? `${options.load} busy process${options.load === 1 ? "" : "es"} alongside`
      : "no extra load",
  ];
  if (options.coverage) parts.push("coverage on");
  return `${parts.join(", ")} (Node ${machine.node}, ${machine.platform} ${machine.arch}, ${machine.cpus} CPUs)`;
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The failures section: every failed run with its seed, its failing tests and
 * the commands that replay it. Empty when every run passed.
 */
export function renderFailures(runs, options, machine) {
  const failed = runs.filter((run) => !run.ok);
  if (failed.length === 0) return "";
  const lines = [`### Failures: ${describeMode(options, machine)}`, ""];
  let listed = 0;
  let unlisted = 0;
  for (const run of failed) {
    const entries = run.failures.length > 0 ? run.failures : [run.crash];
    if (listed >= MAX_LISTED_FAILURES) {
      unlisted += entries.length;
      continue;
    }
    lines.push(`**${run.package}**, round ${run.round}, seed ${inlineCode(String(run.seed))}`, "");
    for (const failure of entries) {
      if (listed >= MAX_LISTED_FAILURES) {
        unlisted++;
        continue;
      }
      listed++;
      const where = failure.file ? `${inlineCode(failure.file)} › ` : "";
      lines.push(`- ${where}${failure.test}`, "");
      if (failure.message) lines.push(codeBlock(failure.message), "");
    }
    const files = [...new Set(run.failures.map((failure) => failure.file).filter(Boolean))];
    lines.push("Replay the same order:", "");
    const commands =
      files.length > 0
        ? files.map((file) => replayCommand(run.package, run.seed, file))
        : [replayCommand(run.package, run.seed)];
    lines.push(codeBlock(commands.join("\n")), "");
  }
  if (unlisted > 0) {
    lines.push(
      `And ${unlisted} more failure(s), listed in failures.json in the run's artifact.`,
      "",
    );
  }
  lines.push(
    "A failure that does not come back with its seed depends on timing rather than order: " +
      "replay it under load with `node scripts/flaky-hunt.mjs --package <name> --parallel --load auto`.",
    "",
  );
  return lines.join("\n");
}

/** The whole report: what ran, one row per run, then the failures. */
export function renderSummary(runs, options, machine) {
  const failedCount = runs.filter((run) => !run.ok).length;
  const lines = [
    "## Flaky-test hunt",
    "",
    describeMode(options, machine),
    "",
    `${runs.length} run${runs.length === 1 ? "" : "s"}, ${failedCount} failed.`,
    "",
    "| Round | Package | Seed | Result | Time |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const run of runs) {
    let result;
    if (run.ok) result = `passed (${run.tests} tests)`;
    else if (run.failures.length > 0) result = `**${run.failures.length} failed**`;
    else result = `**${run.crash.test}**`;
    lines.push(
      `| ${run.round} | ${run.package} | ${run.seed} | ${result} | ${seconds(run.durationMs)} |`,
    );
  }
  lines.push("");
  const failures = renderFailures(runs, options, machine);
  if (failures) lines.push(failures);
  return lines.join("\n");
}

/** The processes this hunt started and has not seen end: suites and load. */
const running = new Set();

/**
 * Stop a process and, for a suite, the workers Vitest started for it: a suite
 * leads its own process group (see `detached` in runSuite), whose id is its pid.
 */
function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (child.groupLeader) process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function track(child) {
  running.add(child);
  child.once("close", () => running.delete(child));
  return child;
}

/** Start `count` processes that keep one CPU each busy, and return what stops them. */
function startLoad(count) {
  const burners = [];
  for (let i = 0; i < count; i++) {
    burners.push(track(spawn(process.execPath, ["-e", "for (;;) {}"], { stdio: "ignore" })));
  }
  return () => {
    for (const burner of burners) stop(burner);
  };
}

/** Run one package's suite once with `seed`, and say how it went. */
function runSuite(pkg, { round, seed, out, coverage }) {
  const slug = pkg.name.replace(/^@/, "").replace(/\//g, "-");
  const reportFile = path.join(out, `round-${round}-${slug}.json`);
  const logFile = path.join(out, `round-${round}-${slug}.log`);
  const vitest = path.join(pkg.dir, "node_modules", "vitest", "vitest.mjs");
  // Coverage only where `pnpm test` measures it, so thresholds apply as there.
  const args = [vitest, ...vitestArgs({ seed, reportFile, coverage: coverage && pkg.coverage })];
  const started = Date.now();

  return new Promise((resolve) => {
    let log = "";
    let timedOut = false;
    let done = false;
    const groupLeader = process.platform !== "win32";
    const child = track(
      spawn(process.execPath, args, {
        cwd: pkg.dir,
        env: { ...ENV, AVAKIT_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        detached: groupLeader,
      }),
    );
    child.groupLeader = groupLeader;
    const collect = (chunk) => {
      log += chunk;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      stop(child);
    }, RUN_TIMEOUT_MS);

    const finish = (code, spawnError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      writeFileSync(logFile, log);
      let report = null;
      try {
        report = JSON.parse(readFileSync(reportFile, "utf8"));
      } catch {
        // No report: the run ended before Vitest wrote one.
      }
      const failures = failuresFromReport(report, pkg.dir, log);
      const ok = code === 0 && !timedOut && failures.length === 0;
      let crash = null;
      if (!ok && failures.length === 0) {
        let test = `(the run failed outside any test, exit status ${code})`;
        if (timedOut) test = `(the run did not finish within ${RUN_TIMEOUT_MS / 60000} minutes)`;
        if (spawnError) test = `(the run could not start: ${spawnError.message})`;
        crash = { file: null, test, message: tail(log) };
      }
      resolve({
        package: pkg.name,
        round,
        seed,
        ok,
        tests: report?.numTotalTests ?? 0,
        failures,
        crash,
        durationMs: Date.now() - started,
        log: logFile,
      });
    };
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code));
  });
}

/** The lines that say how one run went: one when it passed, more when it failed. */
export function describeRun(run, rounds) {
  const head = `round ${run.round}/${rounds} · ${run.package} · seed ${run.seed}`;
  if (run.ok) return `  passed  ${head} · ${run.tests} tests · ${seconds(run.durationMs)}\n`;
  let text = `  FAILED  ${head} · ${seconds(run.durationMs)} · log: ${run.log}\n`;
  for (const failure of run.failures.length > 0 ? run.failures : [run.crash]) {
    const where = failure.file ? `${failure.file} › ` : "";
    text += `          ${where}${failure.test}\n`;
    for (const line of (failure.message ?? "").split("\n")) {
      if (line) text += `            ${line}\n`;
    }
  }
  return text;
}

/** Node.js, the platform and the CPUs the hunt ran on. */
export function currentMachine() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.availableParallelism(),
  };
}

/**
 * Run every package in `packages` `options.rounds` times, writing each run's log
 * and JSON report to `out`, and return the runs by round and package. `print`
 * receives the progress lines as they happen.
 */
export async function hunt(options, packages, { out, print = () => {} }) {
  const runs = [];
  const used = new Set();
  const stopLoad = startLoad(options.load);
  const run = async (pkg, round, seed) => {
    const result = await runSuite(pkg, { round, seed, out, coverage: options.coverage });
    print(describeRun(result, options.rounds));
    runs.push(result);
  };
  try {
    for (let round = 1; round <= options.rounds; round++) {
      const planned = packages.map((pkg) => ({ pkg, seed: newSeed(used) }));
      for (const { pkg, seed } of planned) {
        print(`  start   round ${round}/${options.rounds} · ${pkg.name} · seed ${seed}\n`);
        if (!options.parallel) await run(pkg, round, seed);
      }
      if (options.parallel) {
        await Promise.all(planned.map(({ pkg, seed }) => run(pkg, round, seed)));
      }
    }
  } finally {
    stopLoad();
  }
  return runs.sort((a, b) => a.round - b.round || a.package.localeCompare(b.package));
}

/** Write summary.md, failures.json and, when anything failed, failures.md to `out`. */
export function writeReports(runs, options, machine, out) {
  const failed = runs.filter((run) => !run.ok);
  const summary = renderSummary(runs, options, machine);
  writeFileSync(path.join(out, "summary.md"), `${summary}\n`);
  const records = failed.map((run) => ({
    package: run.package,
    round: run.round,
    seed: run.seed,
    failures: run.failures.length > 0 ? run.failures : [run.crash],
    log: path.basename(run.log),
  }));
  writeFileSync(path.join(out, "failures.json"), `${JSON.stringify(records, null, 2)}\n`);
  if (failed.length > 0) {
    writeFileSync(path.join(out, "failures.md"), `${renderFailures(runs, options, machine)}\n`);
  }
  return summary;
}

async function main() {
  let options;
  let packages;
  try {
    options = parseArgs(process.argv.slice(2));
    packages = selectPackages(discoverPackages(), options.packages);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  for (const pkg of packages) {
    if (!existsSync(path.join(pkg.dir, "node_modules", "vitest", "vitest.mjs"))) {
      process.stderr.write(`${pkg.name} has no Vitest installed: run pnpm install first.\n`);
      return 2;
    }
  }

  const out = options.out ?? mkdtempSync(path.join(os.tmpdir(), "avakit-flaky-hunt-"));
  mkdirSync(out, { recursive: true });
  const machine = currentMachine();
  process.stdout.write(`Flaky-test hunt: ${describeMode(options, machine)}\n`);
  process.stdout.write(`Packages: ${packages.map((pkg) => pkg.name).join(", ")}\n\n`);

  // The suites lead process groups of their own, so a Ctrl+C in the terminal
  // does not reach them: stop them here, with the load, before leaving.
  const stopOnSignal = (signal) => {
    for (const child of running) stop(child);
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", stopOnSignal);
  process.once("SIGTERM", stopOnSignal);

  const runs = await hunt(options, packages, {
    out,
    print: (text) => process.stdout.write(text),
  });
  const summary = writeReports(runs, options, machine, out);
  if (ENV.GITHUB_STEP_SUMMARY) appendFileSync(ENV.GITHUB_STEP_SUMMARY, `${summary}\n`);

  const failedCount = runs.filter((run) => !run.ok).length;
  process.stdout.write(
    `\n${runs.length} runs, ${failedCount} failed. Logs, JSON reports and summary.md: ${out}\n`,
  );
  return failedCount > 0 ? 1 : 0;
}

/** Whether `node` was started on this file, as opposed to the file being imported. */
function isEntryPoint() {
  if (typeof import.meta.main === "boolean") return import.meta.main;
  // Node.js before 22.18 and 24.2 does not say. The file it was started on is
  // this one when both names lead to the same file.
  const started = process.argv[1];
  if (!started) return false;
  try {
    return realpathSync.native(started) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().then(
    (code) => {
      // Let everything printed leave the pipe before the process ends.
      process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
    },
    (error) => {
      process.stderr.write(`${error?.stack ?? String(error)}\n`);
      process.exit(1);
    },
  );
}
