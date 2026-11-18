#!/usr/bin/env node
/**
 * AvaKit end to end, the way someone who is not set up would go through it:
 * install, scaffold, deploy and mint — on the Fuji testnet, through the MCP
 * server, with nothing but Node.js and npm.
 *
 *   node scripts/e2e-fuji.mjs --source npm [--version <v|latest>] [--skip-chain] [--keep] [--json <file>]
 *   node scripts/e2e-fuji.mjs --source workspace [--skip-chain] [--keep] [--json <file>]
 *
 * --source npm        Use the PUBLISHED packages: start `@avakit/mcp@<version>` with npx, have it
 *                     scaffold the nft-mint template, then `npm install` and `npm run build` the
 *                     app. This is what .github/workflows/e2e-fuji.yml runs on fresh runners.
 * --source workspace  Use this checkout's build of the MCP server (run `pnpm build` first). The
 *                     scaffolded app is installed and built only when the @avakit/* versions it
 *                     pins are what npm has; otherwise that half is skipped, and reported as
 *                     skipped (scripts/smoke-template.sh covers it against this checkout's build).
 * --version           The @avakit/mcp version or dist-tag to test. Default: latest. npm only.
 * --skip-chain        Stop before the on-chain half: no faucet drip, no transactions. The server
 *                     must still offer every tool of the flow: a run against a server that
 *                     cannot deploy or mint fails, whichever half it was asked to run.
 * --keep              Leave the temporary directory, with the scaffolded app, in place.
 * --json <file>       Also write the summary as JSON.
 *
 * The on-chain half makes exactly the calls an agent would make and reads no
 * file of the project itself: the artifact path comes from `scaffold_app`, then
 * `wallet_status`, `deploy_contract`, `write_contract` (mint) and `read_chain`
 * (the owner of token 1). With no AVAKIT_DEPLOYER_KEY in the environment the
 * server signs with a throwaway test wallet that it funds from the hosted Fuji
 * faucet, which is shared and rate-limited. When it refuses or is empty, the
 * run fails and says so: the failing step carries the tool's own reason, and
 * the summary says that the faucet, not necessarily a package, is what failed.
 * A tool that only reads is asked again a few times when it errors, because a
 * node of the public RPC can be a block behind; a tool that sends a
 * transaction, or that may ask the faucet, is never asked twice.
 *
 * Fuji only: the chain is not an option, and AVAKIT_ALLOW_MAINNET is taken out
 * of the server's environment. No private key is accepted, used or printed; a
 * deployer key in the environment reaches the MCP server and no other child.
 *
 * Every child process gets DO_NOT_TRACK=1 (a robot's run is not adoption) and
 * is stopped when the whole run exceeds its time limit: 20 minutes, or
 * AVAKIT_E2E_TIMEOUT_SECONDS. Inside GitHub Actions the summary is also
 * appended to $GITHUB_STEP_SUMMARY.
 *
 * Exit status: 0 when every step that ran passed; 1 when a step failed or the
 * run timed out, after printing that step's raw output; 2 for a usage error;
 * 130, 143 or 129 when it was interrupted (SIGINT, SIGTERM, SIGHUP).
 *
 * Plain Node.js, no dependencies; Linux, macOS and Windows. The parts with no
 * side effects are exported for scripts/e2e-fuji.test.mjs; importing this file
 * runs nothing.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WINDOWS = process.platform === "win32";
// This script is not a Turborepo task and nothing it does is cached, so what it
// reads from the environment has no entry in turbo.json.
const ENV = process.env;
const IN_ACTIONS = ENV.GITHUB_ACTIONS === "true";

const MCP_PACKAGE = "@avakit/mcp";
const TEMPLATE = "nft-mint";
/** The one chain this script is built for. It is not an option. */
const CHAIN = "fuji";
const APP_NAME = "e2e-nft-mint";
/** The packages whose versions the scaffolder stamps into the app it creates. */
const PINNED_PACKAGES = ["@avakit/core", "@avakit/react"];
/**
 * Every tool the flow calls. A server must list all of them, also when this run
 * stops before the on-chain half: the flow is not there without them.
 */
const REQUIRED_TOOLS = [
  "scaffold_app",
  "deploy_contract",
  "write_contract",
  "read_chain",
  "wallet_status",
];
/**
 * The steps whose tool signs, and so may have the server ask the faucet to fund
 * its test wallet first.
 */
const SIGNING_STEPS = ["deploy", "mint"];
/** Looked for on PATH and reported. None of them is needed. */
const PATH_TOOLS = ["pnpm", "yarn", "bun", "forge"];
const MCP_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_TIMEOUT_SECONDS = 20 * 60;
/** How long the MCP server gets to exit by itself once its stdin is closed. */
const SERVER_EXIT_GRACE_MS = 5_000;
/** How often a tool that only reads is asked before its error counts, and how far apart. */
const READ_ATTEMPTS = 4;
const READ_RETRY_MS = 3_000;

/**
 * Every npm and npx command this script runs, word by word.
 *
 * On Windows npm and npx are `.cmd` shims, which Node only starts through a
 * shell, so there (and only there) the words are joined into one command line.
 * That is safe because these are the only words that can ever be on it:
 * nothing the user typed and nothing a tool returned is added to them. The one
 * thing that varies, the @avakit/mcp version, reaches npx as a separate
 * argument where there is no shell and in an environment variable where there
 * is one (see `startServerStep`).
 */
const COMMANDS = Object.freeze({
  npmVersion: ["npm", "--version"],
  npx: ["npx", "--yes"],
  npxMcpBin: ["npx", "--yes", "avakit-mcp"],
  install: ["npm", "install"],
  build: ["npm", "run", "build"],
  "view @avakit/core": ["npm", "view", "@avakit/core", "versions", "--json"],
  "view @avakit/react": ["npm", "view", "@avakit/react", "versions", "--json"],
});
const COMMAND_WORD = /^[A-Za-z0-9@/._-]+$/;

/** All an agent needs of the NFT's ABI to check a mint: `ownerOf(uint256)`. */
const OWNER_OF_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
];

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

const USAGE = `Usage:
  node scripts/e2e-fuji.mjs --source npm [--version <v|latest>] [--skip-chain] [--keep] [--json <file>]
  node scripts/e2e-fuji.mjs --source workspace [--skip-chain] [--keep] [--json <file>]

  --source npm         test the published packages (@avakit/mcp from npm, started with npx)
  --source workspace   test this checkout's build of the MCP server (run "pnpm build" first)
  --version <v>        the @avakit/mcp version or dist-tag to test (npm only; default: latest)
  --skip-chain         stop before the on-chain half: no faucet drip, no transactions
                       (the server must still list every tool of the flow)
  --keep               keep the temporary directory with the scaffolded app
  --json <file>        also write the summary as JSON
`;

// ── Arguments ────────────────────────────────────────────────────────────────

class UsageError extends Error {}

/** A step failed. `output` is the raw output of whatever it ran, when there is any. */
class StepError extends Error {
  constructor(message, output = "") {
    super(message);
    this.output = output;
  }
}

function parseArgs(argv) {
  const options = { source: undefined, version: undefined, skipChain: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);
    const value = () => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError(`Option ${flag} needs a value.`);
      }
      i++;
      return next;
    };
    const noValue = () => {
      if (inline !== undefined) throw new UsageError(`Option ${flag} does not take a value.`);
    };
    if (flag === "--help" || flag === "-h") return { help: true };
    if (flag === "--source") options.source = value();
    else if (flag === "--version") options.version = value();
    else if (flag === "--json") options.json = value();
    else if (flag === "--skip-chain") {
      noValue();
      options.skipChain = true;
    } else if (flag === "--keep") {
      noValue();
      options.keep = true;
    } else throw new UsageError(`Unknown option "${arg}".`);
  }

  if (options.source !== "npm" && options.source !== "workspace") {
    throw new UsageError(
      options.source === undefined
        ? "Say what to test: --source npm (the published packages) or --source workspace."
        : `Unknown source "${options.source}". Valid sources: npm, workspace.`,
    );
  }
  if (options.source === "workspace" && options.version !== undefined) {
    throw new UsageError("--version only applies to --source npm.");
  }
  if (options.source === "npm") {
    options.version ??= "latest";
    // A version or a dist-tag and nothing else: no range, no URL, no path.
    if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(options.version)) {
      throw new UsageError(
        `Invalid --version "${options.version}". Give a version (0.1.28) or a dist-tag (latest).`,
      );
    }
  }
  if (options.json === "") throw new UsageError("Option --json needs a file name.");
  return options;
}

function timeoutSeconds() {
  const raw = ENV.AVAKIT_E2E_TIMEOUT_SECONDS;
  if (raw === undefined || raw === "") return DEFAULT_TIMEOUT_SECONDS;
  if (!/^[1-9]\d{0,5}$/.test(raw)) {
    throw new UsageError(
      `AVAKIT_E2E_TIMEOUT_SECONDS must be a whole number of seconds, not "${raw}".`,
    );
  }
  return Number(raw);
}

// ── Output ───────────────────────────────────────────────────────────────────

/**
 * A deployer key in the environment is the server's business; this script
 * never uses it. It is looked at here for one reason: so that, if a tool or
 * npm ever echoed it, this script would not repeat it in what it prints or
 * writes.
 */
const redact = (() => {
  const hex = /^(?:0x)?([0-9a-fA-F]{32,})$/.exec((ENV.AVAKIT_DEPLOYER_KEY ?? "").trim());
  if (!hex) return (text) => text;
  const pattern = new RegExp(`(?:0x)?${hex[1]}`, "gi");
  return (text) => text.replace(pattern, "[redacted]");
})();

function say(text = "") {
  process.stdout.write(`${redact(text)}\n`);
}

/** Start a long stretch of a child's output; folded in the GitHub Actions log. */
function group(title) {
  if (IN_ACTIONS) say(`::group::${title}`);
  return () => {
    if (IN_ACTIONS) say("::endgroup::");
  };
}

/** Keeps the last `limit` characters of everything added. */
function tail(limit) {
  let text = "";
  return {
    add(chunk) {
      text = (text + chunk).slice(-limit);
    },
    get text() {
      return text;
    },
  };
}

/** Calls `onLine` for each complete line of the chunks it is fed. */
function lineSplitter(onLine) {
  let rest = "";
  return {
    feed(chunk) {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) onLine(line.replace(/\r$/, ""));
    },
    flush() {
      if (rest !== "") onLine(rest.replace(/\r$/, ""));
      rest = "";
    },
  };
}

function oneLine(value, limit = 600) {
  const text = (typeof value === "string" ? value : JSON.stringify(value)).replace(/\s+/g, " ");
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function seconds(ms) {
  return (ms / 1000).toFixed(1);
}

// ── Child processes ──────────────────────────────────────────────────────────

/** Every child process still running, so that all of them can be stopped. */
const running = new Set();

/**
 * The environment a child gets.
 *
 * @param {Record<string, string>} [extra] Set on top of it.
 * @param {object} [options]
 * @param {boolean} [options.server] The child is the MCP server, the one
 *   process a deployer key in the environment is meant for.
 */
function childEnv(extra = {}, { server = false } = {}) {
  const env = { ...ENV };
  // The server has to create the project where this script looks for it, and
  // it must not be able to sign for mainnet whatever this shell has set. A
  // deployer key is the server's alone: `npm install` runs the install scripts
  // of every dependency, and none of them has any business seeing it.
  // (Environment variable names are case-insensitive on Windows.)
  for (const name of Object.keys(env)) {
    const upper = name.toUpperCase();
    if (upper === "AVAKIT_ALLOW_MAINNET" || upper === "AVAKIT_MCP_ROOT") delete env[name];
    if (upper === "AVAKIT_DEPLOYER_KEY" && !server) delete env[name];
  }
  return {
    ...env,
    DO_NOT_TRACK: "1",
    AVAKIT_TELEMETRY_DISABLED: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    ...extra,
  };
}

function track(child) {
  running.add(child);
  child.once("close", () => running.delete(child));
  child.once("error", () => {
    // It never started, so there will be no "close".
    if (child.pid === undefined) running.delete(child);
  });
  return child;
}

/**
 * Start npm or npx.
 *
 * @param {readonly string[]} words One of COMMANDS.
 * @param {object} options For `spawn`.
 * @param {string[]} [extraArgs] Further arguments. Only where no shell is
 *   involved: on Windows they are refused, whatever they are.
 */
function spawnNpm(words, options, extraArgs = []) {
  if (!Object.values(COMMANDS).includes(words) || !words.every((word) => COMMAND_WORD.test(word))) {
    throw new Error(`Not one of this script's fixed commands: ${words.join(" ")}`);
  }
  if (IS_WINDOWS) {
    if (extraArgs.length > 0) {
      throw new Error("Nothing may be added to a command line that goes through a shell.");
    }
    return track(spawn(words.join(" "), { ...options, shell: true, windowsHide: true }));
  }
  // Its own process group, so that stopping it also stops what it started.
  return track(spawn(words[0], [...words.slice(1), ...extraArgs], { ...options, detached: true }));
}

/** Start this Node.js on a script. No shell on any platform. */
function spawnNode(script, options) {
  return track(
    spawn(process.execPath, [script], { ...options, detached: !IS_WINDOWS, windowsHide: true }),
  );
}

/** Stop a child and everything it started. */
function stop(child, signal = "SIGTERM") {
  if (child.pid === undefined) return;
  if (IS_WINDOWS) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The whole group is gone already.
  }
}

/** Resolves true once the child's process and its output streams are gone. */
function closed(child, withinMs) {
  return new Promise((resolve) => {
    if (!running.has(child)) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), withinMs);
    child.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Stop every child, and wait until they are gone. */
async function stopEverything() {
  const children = [...running];
  for (const child of children) stop(child);
  await Promise.all(
    children.map(async (child) => {
      if (await closed(child, 3_000)) return;
      stop(child, "SIGKILL");
      await closed(child, 2_000);
    }),
  );
}

/**
 * Run one of COMMANDS to the end.
 *
 * @param {readonly string[]} words
 * @param {object} options
 * @param {string} options.cwd
 * @param {boolean} [options.show] Print the output as it arrives.
 * @param {{ add(chunk: string): void }} [options.capture] Also gets each chunk
 *   as it arrives, so that the output so far is there if the run is cut short.
 */
function run(words, { cwd, show = false, capture }) {
  return new Promise((resolve) => {
    let stdout = "";
    const output = tail(64_000);
    const print = lineSplitter((line) => say(`       | ${line}`));
    const take = (chunk, isStdout) => {
      if (isStdout) stdout += chunk;
      output.add(chunk);
      capture?.add(chunk);
      if (show) print.feed(chunk);
    };
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (show) print.flush();
      resolve({ ...result, stdout, output: output.text });
    };
    let child;
    try {
      child = spawnNpm(words, { cwd, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      settle({ code: null, error });
      return;
    }
    child.stdout.setEncoding("utf8").on("data", (chunk) => take(chunk, true));
    child.stderr.setEncoding("utf8").on("data", (chunk) => take(chunk, false));
    child.once("error", (error) => settle({ code: null, error }));
    child.once("close", (code, signal) => settle({ code, signal }));
  });
}

/** Why a finished command counts as failed, or null when it succeeded. */
function failureOf(words, result) {
  const command = words.join(" ");
  if (result.error) {
    return result.error.code === "ENOENT"
      ? `"${words[0]}" was not found on PATH`
      : `"${command}" could not be started (${result.error.message})`;
  }
  if (result.code === 0) return null;
  return result.code === null
    ? `"${command}" was stopped by ${result.signal ?? "a signal"}`
    : `"${command}" exited with code ${result.code}`;
}

// ── The MCP client ───────────────────────────────────────────────────────────

/**
 * A minimal MCP client: JSON-RPC 2.0, one message per line, over the server's
 * stdin and stdout. It is what Claude Code, Cursor and every other MCP client
 * speak to a stdio server.
 */
class McpClient {
  #child;
  #nextId = 1;
  #pending = new Map();
  #death = null;
  /** The last of what the server wrote to stderr. */
  stderr = tail(16_000);
  /** Lines on stdout that were not JSON-RPC. There should be none. */
  noise = [];
  /** The error of the last read that was asked again. */
  lastReadError = "";
  #readRetryMs;
  #say;

  /**
   * @param {import("node:child_process").ChildProcess} child The server, with all three of its
   *   streams piped.
   * @param {object} [options]
   * @param {number} [options.readRetryMs] How long to wait before a read is asked again.
   * @param {(text: string) => void} [options.log] Where the conversation is printed.
   */
  constructor(child, { readRetryMs = READ_RETRY_MS, log: print = say } = {}) {
    this.#child = child;
    this.#readRetryMs = readRetryMs;
    this.#say = print;
    const messages = lineSplitter((line) => this.#receive(line));
    child.stdout.setEncoding("utf8").on("data", (chunk) => messages.feed(chunk));
    const log = lineSplitter((line) => print(`       [server] ${line}`));
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      this.stderr.add(chunk);
      log.feed(chunk);
    });
    // Writing to a server that has died fails here; "close" reports the death.
    child.stdin.on("error", () => {});
    child.once("error", (error) => {
      const hint = error.code === "ENOENT" ? " (is it on PATH?)" : "";
      this.#die(`The process could not be started: ${error.message}${hint}.`);
    });
    // "close" rather than "exit": by then everything it wrote has been read.
    child.once("close", (code, signal) => {
      messages.flush();
      log.flush();
      this.#die(`The process ended (${code === null ? signal : `exit code ${code}`}).`);
    });
  }

  #die(message) {
    if (this.#death) return;
    this.#death = new StepError(message, this.stderr.text);
    for (const { reject } of this.#pending.values()) reject(this.#death);
    this.#pending.clear();
  }

  #send(message) {
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #receive(line) {
    if (line.trim() === "") return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      message = null;
    }
    if (message === null || typeof message !== "object" || message.jsonrpc !== "2.0") {
      if (this.noise.length < 20) this.noise.push(line);
      return;
    }
    if (typeof message.method === "string") {
      // The server asking this client for something. A ping gets its answer;
      // this client declared no capabilities, so it has no other method.
      if (message.id === undefined) return;
      this.#send(
        message.method === "ping"
          ? { jsonrpc: "2.0", id: message.id, result: {} }
          : {
              jsonrpc: "2.0",
              id: message.id,
              error: { code: -32601, message: `Method not found: ${message.method}` },
            },
      );
      return;
    }
    const waiting = this.#pending.get(message.id);
    if (!waiting) return;
    this.#pending.delete(message.id);
    if (message.error) {
      waiting.reject(
        new StepError(
          `The server answered "${waiting.method}" with a JSON-RPC error.`,
          JSON.stringify(message.error, null, 2),
        ),
      );
    } else waiting.resolve(message.result);
  }

  request(method, params) {
    if (this.#death) return Promise.reject(this.#death);
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method });
      this.#send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method) {
    this.#send({ jsonrpc: "2.0", method });
  }

  /**
   * Call a tool and return its text, as an agent receives it.
   *
   * @param {object} [options]
   * @param {boolean} [options.readOnly] The tool only reads. Its error can be a
   *   node of the public RPC that is a block behind, or a moment of bad
   *   network, so it is asked again a few times. Never set for a tool that
   *   sends a transaction: asking that twice could do it twice, and would ask
   *   the shared faucet twice.
   */
  async callTool(name, args, { readOnly = false } = {}) {
    for (let attempt = 1; ; attempt++) {
      this.#say(`       > ${name} ${oneLine(args)}`);
      const result = await this.request("tools/call", { name, arguments: args });
      const parts = Array.isArray(result?.content) ? result.content : [];
      const text = parts
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");
      if (result?.isError !== true) {
        this.#say(`       < ${oneLine(text)}`);
        return { text, attempts: attempt };
      }
      if (!readOnly || attempt === READ_ATTEMPTS) {
        // The tool's own words are the reason, so they go where the step's
        // result is shown and not only into its raw output.
        const reason = oneLine(text, 500) || "it gave no reason";
        const asked = attempt > 1 ? ` (asked ${attempt} times)` : "";
        throw new StepError(
          `${name} reported an error${asked}: ${reason}`,
          text || JSON.stringify(result, null, 2),
        );
      }
      this.lastReadError = text;
      this.#say(`       ! ${oneLine(text, 300)}`);
      this.#say(`       ! a read is safe to repeat: asking again in ${this.#readRetryMs / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, this.#readRetryMs));
    }
  }

  /** Call a tool whose answer is a JSON document, and return it parsed as well. */
  async callJsonTool(name, args, options) {
    const { text, attempts } = await this.callTool(name, args, options);
    try {
      return { data: JSON.parse(text), text, attempts };
    } catch {
      throw new StepError(`${name} did not answer with JSON.`, text);
    }
  }

  /**
   * Close stdin, which is how a client ends a stdio server, and wait for it to
   * go. False if it had to be stopped instead.
   */
  async close() {
    if (!running.has(this.#child)) return true;
    this.#child.stdin.end();
    if (await closed(this.#child, SERVER_EXIT_GRACE_MS)) return true;
    stop(this.#child);
    if (!(await closed(this.#child, 2_000))) stop(this.#child, "SIGKILL");
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function isOnPath(name) {
  const extensions = IS_WINDOWS
    ? (ENV.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const dir of (ENV.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const file = path.join(dir, name + extension);
      try {
        if (!statSync(file).isFile()) continue;
        if (!IS_WINDOWS) accessSync(file, constants.X_OK);
        return true;
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return false;
}

function describeOs() {
  const release = os.release();
  if (IS_WINDOWS) return `${os.version()} (${release}) ${os.arch()}`;
  if (process.platform === "darwin") return `macOS (Darwin ${release}) ${os.arch()}`;
  if (process.platform === "linux") {
    let name = "Linux";
    try {
      const line = readFileSync("/etc/os-release", "utf8")
        .split("\n")
        .find((entry) => entry.startsWith("PRETTY_NAME="));
      if (line) name = line.slice("PRETTY_NAME=".length).replace(/^"|"$/g, "");
    } catch {
      // No os-release file. The kernel version still says what this is.
    }
    return `${name} (Linux ${release}) ${os.arch()}`;
  }
  return `${os.type()} ${release} ${os.arch()}`;
}

/** `[major, minor, patch]` of a plain release version; null for anything else, prereleases included. */
function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersions(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Whether a published version satisfies a pin as the scaffolder writes it: `^x.y.z` or `x.y.z`. */
function satisfies(version, range) {
  const candidate = parseVersion(version);
  if (!candidate) return false;
  const exact = parseVersion(range);
  if (exact) return compareVersions(candidate, exact) === 0;
  const floor = range.startsWith("^") ? parseVersion(range.slice(1)) : null;
  if (!floor) throw new StepError(`Cannot tell which versions the range "${range}" allows.`);
  if (compareVersions(candidate, floor) < 0) return false;
  if (floor[0] > 0) return candidate[0] === floor[0];
  if (floor[1] > 0) return candidate[0] === 0 && candidate[1] === floor[1];
  return candidate[0] === 0 && candidate[1] === 0 && candidate[2] === floor[2];
}

/** Every string inside a JSON value, however deeply it is nested. */
function stringsIn(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

/**
 * The versions of a package that npm has, from `npm view <name> versions --json`.
 * An empty list when the package is not on the registry at all.
 */
function publishedVersions(name, result) {
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = undefined;
  }
  // npm prints one version as a string and several as an array, and newer npm
  // versions wrap the answer once more. The version strings are what matters.
  if (result.code === 0 && parsed !== undefined) {
    return stringsIn(parsed).filter((entry) => parseVersion(entry) !== null);
  }
  if (parsed?.error?.code === "E404" || /\bE404\b/.test(result.output)) return [];
  const failure = failureOf(COMMANDS[`view ${name}`], result) ?? "its answer was not JSON";
  throw new StepError(
    `Could not ask npm which versions of ${name} are published: ${failure}.`,
    result.output,
  );
}

/** The changesets in this checkout that are not released yet, by the package of `names` they bump. */
function pendingChangesets(names) {
  const dir = path.join(REPO, ".changeset");
  const pending = new Map();
  let files;
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".md") && file !== "README.md");
  } catch {
    return pending;
  }
  for (const file of files.sort()) {
    const text = readFileSync(path.join(dir, file), "utf8");
    const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!frontMatter) continue;
    for (const line of frontMatter[1].split("\n")) {
      const bump = /^\s*["']?([^"':\s]+)["']?\s*:\s*(?:major|minor|patch)\s*$/.exec(line);
      if (bump && names.includes(bump[1])) {
        pending.set(bump[1], [...(pending.get(bump[1]) ?? []), file]);
      }
    }
  }
  return pending;
}

/**
 * The explorer page next to `url`: the same address with `suffix` at its end
 * replaced by `replacement`. Null when `url` does not end that way.
 */
function siblingUrl(url, suffix, replacement) {
  if (typeof url !== "string" || !url.toLowerCase().endsWith(suffix.toLowerCase())) return null;
  return `${url.slice(0, -suffix.length)}${replacement}`;
}

/**
 * Whether a failed step failed at the faucet: one of the steps whose tool has
 * the server fund its test wallet, with an answer that names the faucet.
 */
function isFaucetFailure(step) {
  return SIGNING_STEPS.includes(step.id) && /faucet/i.test(`${step.detail}\n${step.output}`);
}

/** The tools of the flow that a server's list does not have. */
function missingTools(listed) {
  return REQUIRED_TOOLS.filter((tool) => !listed.includes(tool));
}

/**
 * The artifact paths in what `scaffold_app` reports as `artifacts`: a list of
 * paths, a list of objects that carry one, or a map from contract to path.
 */
function artifactPaths(artifacts) {
  const paths = [];
  const collect = (value) => {
    if (typeof value === "string") paths.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value !== null && typeof value === "object") {
      const named = value.path ?? value.artifactPath;
      if (typeof named === "string") paths.push(named);
      else Object.values(value).forEach(collect);
    }
  };
  collect(artifacts);
  // A contract name next to a path is not a path: artifacts are source or JSON files.
  return paths.filter((entry) => /\.(?:[cm]?[jt]s|json)$/.test(entry));
}

// ── The steps ────────────────────────────────────────────────────────────────

/** What the steps learn along the way, and what the summary is written from. */
const state = {
  workDir: null,
  appDir: null,
  environment: null,
  /** @type {McpClient | null} */
  server: null,
  serverInfo: null,
  /** The package versions that were really in play. */
  packages: {},
  scaffold: null,
  scaffoldText: "",
  /** Workspace only: why the app is not installed and built, when it is not. */
  installSkipped: null,
  chain: null,
  warnings: [],
};

async function environmentStep() {
  const npm = await run(COMMANDS.npmVersion, { cwd: state.workDir });
  const failure = failureOf(COMMANDS.npmVersion, npm);
  if (failure) throw new StepError(`npm is required: ${failure}.`, npm.output);
  const tools = Object.fromEntries(PATH_TOOLS.map((tool) => [tool, isOnPath(tool)]));
  state.environment = {
    os: describeOs(),
    platform: process.platform,
    arch: os.arch(),
    node: process.versions.node,
    npm: npm.stdout.trim(),
    tools,
    runner: IN_ACTIONS
      ? {
          os: ENV.RUNNER_OS ?? null,
          image: ENV.ImageOS ?? null,
          imageVersion: ENV.ImageVersion ?? null,
        }
      : null,
  };
  const present = PATH_TOOLS.filter((tool) => tools[tool]);
  const absent = PATH_TOOLS.filter((tool) => !tools[tool]);
  return [
    state.environment.os,
    `Node ${state.environment.node}`,
    `npm ${state.environment.npm}`,
    `also on PATH: ${present.join(", ") || "none of pnpm, yarn, bun, forge"}`,
    ...(present.length > 0 && absent.length > 0 ? [`not on PATH: ${absent.join(", ")}`] : []),
  ].join("; ");
}

function startServerStep(options) {
  return async () => {
    // The server's working directory is where it creates projects, and what the
    // artifact paths it reports are relative to.
    const spawnOptions = {
      cwd: state.workDir,
      env: childEnv({}, { server: true }),
      stdio: ["pipe", "pipe", "pipe"],
    };
    let child;
    let startedWith;
    if (options.source === "workspace") {
      const entry = path.join(REPO, "packages", "mcp", "dist", "index.js");
      if (!existsSync(entry)) {
        throw new StepError(
          "packages/mcp is not built. Build the workspace first: pnpm build " +
            '(or just what the server needs: pnpm exec turbo run build --filter="@avakit/mcp").',
        );
      }
      startedWith = "node packages/mcp/dist/index.js";
      child = spawnNode(entry, spawnOptions);
    } else if (IS_WINDOWS) {
      // Through a shell here, so the version stays off the command line: npm
      // reads the package to install from npm_config_package and runs the bin
      // that the command names. It is `npx --yes @avakit/mcp@<version>`.
      const spec = `${MCP_PACKAGE}@${options.version}`;
      startedWith = `${COMMANDS.npxMcpBin.join(" ")} (with npm_config_package=${spec})`;
      spawnOptions.env = childEnv({ npm_config_package: spec }, { server: true });
      child = spawnNpm(COMMANDS.npxMcpBin, spawnOptions);
    } else {
      const spec = `${MCP_PACKAGE}@${options.version}`;
      startedWith = `${COMMANDS.npx.join(" ")} ${spec}`;
      child = spawnNpm(COMMANDS.npx, spawnOptions, [spec]);
    }
    say(`       $ ${startedWith}`);
    const server = new McpClient(child);
    state.server = server;

    let hello;
    try {
      hello = await server.request("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "avakit-e2e", version: "1.0.0" },
      });
    } catch (error) {
      // With npx this is also where a package that cannot be installed shows up.
      throw new StepError(
        `"${startedWith}" did not become an MCP server. ${error.message}`,
        error.output,
      );
    }
    server.notify("notifications/initialized");
    const name = typeof hello?.serverInfo?.name === "string" ? hello.serverInfo.name : null;
    const version =
      typeof hello?.serverInfo?.version === "string" ? hello.serverInfo.version : null;
    state.serverInfo = {
      name,
      version,
      startedWith,
      protocolVersion: hello?.protocolVersion ?? null,
    };
    if (version) state.packages[MCP_PACKAGE] = version;
    if (options.source === "npm" && parseVersion(options.version) && version !== options.version) {
      throw new StepError(
        `npm was asked for ${MCP_PACKAGE}@${options.version}, but the server that answered is version ${version}.`,
        JSON.stringify(hello, null, 2),
      );
    }
    return `${startedWith} -> ${name ?? "a server"} ${version ?? "(no version)"}, MCP ${hello?.protocolVersion ?? "?"} over stdio`;
  };
}

async function listToolsStep() {
  const names = [];
  let cursor;
  // A server may hand over its tools a page at a time.
  for (let page = 0; page < 20; page++) {
    const result = await state.server.request("tools/list", cursor ? { cursor } : undefined);
    for (const tool of result?.tools ?? []) names.push(tool.name);
    cursor = result?.nextCursor;
    if (!cursor) break;
  }
  const missing = missingTools(names);
  if (missing.length > 0) {
    throw new StepError(
      `The server has no ${missing.join(", ")}. The flow needs: ${REQUIRED_TOOLS.join(", ")}.`,
      `The server lists ${names.length} tools: ${names.join(", ") || "none"}`,
    );
  }
  return `${names.length} tools: ${names.join(", ")}`;
}

async function scaffoldStep() {
  const { data, text } = await state.server.callJsonTool("scaffold_app", {
    name: APP_NAME,
    template: TEMPLATE,
    chain: CHAIN,
  });
  state.scaffold = data;
  state.scaffoldText = text;
  if (!existsSync(path.join(state.appDir, "package.json"))) {
    throw new StepError(
      `scaffold_app answered, but there is no ${APP_NAME}/package.json in the server's working directory.`,
      text,
    );
  }
  const files = typeof data?.filesCreated === "number" ? `${data.filesCreated} files` : "the app";
  return `scaffold_app created ${files} in ${APP_NAME}/ (template ${TEMPLATE}, chain ${CHAIN})`;
}

/**
 * Workspace only. The app pins @avakit/core and @avakit/react by version, and
 * npm installs those from the registry. Installing and building the app is
 * only a test of this checkout when what npm hands over is this checkout's
 * code: the pinned versions are published, and nothing unreleased sits on top.
 */
async function pinsStep() {
  const manifest = readJson(path.join(state.appDir, "package.json"));
  const pins = [];
  for (const name of PINNED_PACKAGES) {
    const range = manifest?.dependencies?.[name];
    if (typeof range !== "string") {
      throw new StepError(`The scaffolded package.json does not depend on ${name}.`);
    }
    const command = COMMANDS[`view ${name}`];
    say(`       $ ${command.join(" ")}`);
    const versions = publishedVersions(name, await run(command, { cwd: state.workDir }));
    const published = versions.filter((version) => satisfies(version, range)).pop() ?? null;
    pins.push({ name, range, published });
  }
  const pinned = pins.map((pin) => `${pin.name}@${pin.range}`).join(" and ");

  const unpublished = pins.filter((pin) => pin.published === null);
  if (unpublished.length > 0) {
    const which = unpublished.map((pin) => `${pin.name}@${pin.range}`).join(" and ");
    state.installSkipped = `${which} ${unpublished.length === 1 ? "is" : "are"} not on npm yet`;
    return `the app pins ${pinned}; ${state.installSkipped}, so the app is not installed or built`;
  }
  const pending = pendingChangesets(PINNED_PACKAGES);
  if (pending.size > 0) {
    const names = [...pending.keys()].join(" and ");
    const files = [...new Set([...pending.values()].flat())].map((file) => `.changeset/${file}`);
    state.installSkipped = `this checkout has unreleased changes to ${names}, so the versions npm has are not the code under test`;
    return `the app pins ${pinned}; npm has both, but ${files.join(" and ")} ${files.length === 1 ? "is" : "are"} not released yet, so the app is not installed or built`;
  }
  const published = pins.map((pin) => `${pin.name} ${pin.published}`).join(" and ");
  return `the app pins ${pinned}; npm has ${published}, and no unreleased change to them is waiting in .changeset`;
}

function npmStep(words, describe) {
  return async (capture) => {
    if (state.installSkipped) {
      return {
        skipped: `${state.installSkipped}; scripts/smoke-template.sh covers install and build against this checkout's build`,
      };
    }
    say(`       $ ${words.join(" ")}    (in ${APP_NAME}/)`);
    const end = group(words.join(" "));
    const result = await run(words, { cwd: state.appDir, show: true, capture });
    end();
    const failure = failureOf(words, result);
    if (failure) throw new StepError(`${failure}.`, result.output);
    return describe();
  };
}

/** What `npm install` really put in place. */
function describeInstall() {
  for (const name of PINNED_PACKAGES) {
    const manifest = path.join(state.appDir, "node_modules", ...name.split("/"), "package.json");
    const version = readJson(manifest)?.version;
    if (typeof version === "string") state.packages[name] = version;
  }
  const installed = PINNED_PACKAGES.filter((name) => state.packages[name]).map(
    (name) => `${name} ${state.packages[name]}`,
  );
  return `npm install${installed.length > 0 ? ` -> ${installed.join(", ")}` : ""}`;
}

async function artifactStep() {
  const paths = artifactPaths(state.scaffold?.artifacts);
  if (paths.length === 0) {
    throw new StepError(
      "scaffold_app did not report any `artifacts`, so there is no artifact path to give " +
        "deploy_contract. This script does not go looking for one in the project: an agent " +
        "would not know where to look either.",
      state.scaffoldText,
    );
  }
  // nft-mint ships one contract. Should a template ever report several, the NFT is the one.
  const artifactPath = paths.find((entry) => /nft/i.test(path.basename(entry))) ?? paths[0];
  state.chain = { network: CHAIN, artifactPath };
  return `${artifactPath} (from scaffold_app's artifacts)`;
}

async function walletStep() {
  const { data, text } = await state.server.callJsonTool(
    "wallet_status",
    { chain: CHAIN },
    { readOnly: true },
  );
  // Before anything is signed: the wallet the server shows must be the one for
  // the chain that was asked about.
  if (typeof data?.chain === "string" && !/fuji/i.test(data.chain)) {
    throw new StepError(
      `wallet_status was asked about ${CHAIN} and answered for "${oneLine(data.chain, 80)}". Nothing was sent.`,
      text,
    );
  }
  state.chain.walletBefore = {
    address: data?.address ?? null,
    source: data?.source ?? null,
    balanceAvax: data?.balanceAvax ?? null,
  };
  if (!data?.address || data.source === "none") {
    return 'no wallet yet (source "none"): deploy_contract is to create a test wallet and fund it from the faucet';
  }
  return `${data.address} (${data.source}), ${data.balanceAvax ?? "?"} AVAX`;
}

async function deployStep() {
  // The template's demo deploys with `deploy({ abi, bytecode })`: no constructor arguments.
  const { data, text } = await state.server.callJsonTool("deploy_contract", {
    artifactPath: state.chain.artifactPath,
    chain: CHAIN,
  });
  if (!ADDRESS.test(data?.address ?? "") || !TX_HASH.test(data?.txHash ?? "")) {
    throw new StepError(
      "deploy_contract did not return a contract address and a transaction hash.",
      text,
    );
  }
  const contractUrl = typeof data.explorerUrl === "string" ? data.explorerUrl : null;
  Object.assign(state.chain, {
    contractAddress: data.address,
    contractUrl,
    deployTxHash: data.txHash,
    // The tool links the contract; the transaction is on the same explorer.
    deployTxUrl: siblingUrl(contractUrl, `/address/${data.address}`, `/tx/${data.txHash}`),
    deployer: { address: data.signer?.address ?? null, source: data.signer?.source ?? null },
    notes: data.note ? [String(data.note)] : [],
  });
  return `contract ${data.address}, transaction ${data.txHash}, signed by ${data.signer?.address ?? "?"} (${data.signer?.source ?? "?"})`;
}

async function mintStep() {
  // The template's demo mints with `write("mint", [])`: no arguments.
  const { data, text } = await state.server.callJsonTool("write_contract", {
    address: state.chain.contractAddress,
    artifactPath: state.chain.artifactPath,
    functionName: "mint",
    chain: CHAIN,
  });
  if (!TX_HASH.test(data?.txHash ?? "") || data?.status !== "success") {
    throw new StepError(
      'write_contract did not return a transaction hash with status "success".',
      text,
    );
  }
  Object.assign(state.chain, {
    mintTxHash: data.txHash,
    mintTxUrl: typeof data.explorerUrl === "string" ? data.explorerUrl : null,
    mintBlock: data.blockNumber ?? null,
    signer: { address: data.signer?.address ?? null, source: data.signer?.source ?? null },
  });
  if (data.note) state.chain.notes.push(String(data.note));
  // Should the deploy's link not have been one to the contract's page, the
  // mint's link still says where this explorer keeps its transactions.
  state.chain.deployTxUrl ??= siblingUrl(
    state.chain.mintTxUrl,
    `/tx/${data.txHash}`,
    `/tx/${state.chain.deployTxHash}`,
  );
  const deployer = state.chain.deployer?.address;
  const minter = state.chain.signer.address;
  if (deployer && minter && deployer.toLowerCase() !== minter.toLowerCase()) {
    state.warnings.push(
      `The contract was deployed by ${deployer} and the token minted by ${minter}: the server changed wallets between the two calls.`,
    );
  }
  return `transaction ${data.txHash} in block ${data.blockNumber ?? "?"}, signed by ${data.signer?.address ?? "?"} (${data.signer?.source ?? "?"})`;
}

async function verifyStep() {
  const minter = state.chain.signer?.address ?? "";
  if (!ADDRESS.test(minter)) {
    throw new StepError(
      "write_contract did not say which address signed the mint, so there is no owner to expect.",
    );
  }
  // The first token this contract mints is token 1, and it goes to the caller.
  const { text, attempts } = await state.server.callTool(
    "read_chain",
    {
      action: "contractRead",
      chain: CHAIN,
      address: state.chain.contractAddress,
      abi: OWNER_OF_ABI,
      functionName: "ownerOf",
      args: [1],
    },
    { readOnly: true },
  );
  const contract = state.chain.contractAddress.toLowerCase();
  const owners = (text.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) ?? []).filter(
    (address) => address.toLowerCase() !== contract,
  );
  const owner = owners.find((address) => address.toLowerCase() === minter.toLowerCase());
  state.chain.ownerOfToken1 = owner ?? owners[0] ?? null;
  if (!owner) {
    throw new StepError(`ownerOf(1) should be ${minter}, the address that minted.`, text);
  }
  const asked = attempts > 1 ? ` (read_chain answered on attempt ${attempts})` : "";
  return `ownerOf(1) is ${owner}, the address that minted${asked}`;
}

function plan(options) {
  const steps = [
    ["environment", "Environment", environmentStep],
    ["server", "Start the MCP server", startServerStep(options)],
    ["tools", "List its tools", listToolsStep],
    ["scaffold", `Scaffold ${TEMPLATE}`, scaffoldStep],
  ];
  if (options.source === "workspace") steps.push(["pins", "Check the pins against npm", pinsStep]);
  steps.push(
    ["install", "Install with npm", npmStep(COMMANDS.install, describeInstall)],
    ["build", "Build the app", npmStep(COMMANDS.build, () => "npm run build")],
  );
  if (!options.skipChain) {
    steps.push(
      ["artifact", "Find the contract artifact", artifactStep],
      ["wallet", "Wallet status", walletStep],
      ["deploy", "Deploy the contract", deployStep],
      ["mint", "Mint a token", mintStep],
      ["verify", "Confirm on chain", verifyStep],
    );
  }
  return steps.map(([id, name, action]) => ({
    id,
    name,
    action,
    status: "not run",
    ms: 0,
    detail: "",
    output: "",
  }));
}

// ── The summary ──────────────────────────────────────────────────────────────

function headline(options, steps, result) {
  const what =
    options.source === "npm"
      ? `the published packages (${MCP_PACKAGE}@${options.version} from npm)`
      : "this checkout's build";
  const where = state.environment
    ? ` on ${state.environment.os}, Node ${state.environment.node}, npm ${state.environment.npm}`
    : "";
  // What a pass does not cover belongs next to the word, not further down.
  const skipped = steps.filter((step) => step.status === "skipped").length;
  const without = [
    ...(options.skipChain ? ["on-chain half not run"] : []),
    ...(skipped > 0 ? [`${skipped} ${skipped === 1 ? "step" : "steps"} skipped`] : []),
  ];
  const verdict = `${result.ok ? "PASSED" : "FAILED"} in ${seconds(result.ms)}s`;
  return `AvaKit end to end ${verdict}${without.length > 0 ? ` (${without.join("; ")})` : ""}: ${what}${where}`;
}

/** `[label, value, link, remark]` for what happened on chain. */
function chainRows() {
  const chain = state.chain;
  if (!chain?.contractAddress) return [];
  const rows = [
    ["Contract", chain.contractAddress, chain.contractUrl, ""],
    ["Deploy transaction", chain.deployTxHash, chain.deployTxUrl, ""],
  ];
  if (chain.mintTxHash) rows.push(["Mint transaction", chain.mintTxHash, chain.mintTxUrl, ""]);
  const signer = chain.signer ?? chain.deployer;
  if (signer?.address) rows.push(["Signer", signer.address, null, ` (${signer.source ?? "?"})`]);
  return rows;
}

function packagesLine() {
  const entries = Object.entries(state.packages);
  return entries.length > 0
    ? entries.map(([name, version]) => `${name} ${version}`).join(", ")
    : "";
}

/** Steps that were skipped, grouped by the reason they share. */
function skippedSteps(steps) {
  const reasons = new Map();
  for (const step of steps.filter((entry) => entry.status === "skipped")) {
    reasons.set(step.detail, [...(reasons.get(step.detail) ?? []), step.name]);
  }
  return [...reasons].map(([reason, names]) => `Skipped (${names.join(", ")}): ${reason}`);
}

/** The step that failed and why, or null when none did. */
function failureOfRun(steps) {
  const step = steps.find((entry) => entry.status === "failed");
  if (!step) return null;
  return { step: step.id, name: step.name, reason: step.detail, faucet: isFaucetFailure(step) };
}

const FAUCET_NOTE =
  "The failing tool's answer names the faucet: the wallet that signs could not be funded. " +
  "On Fuji the server funds its test wallet from the shared, rate-limited AvaKit faucet, and " +
  "this is what a run looks like when that faucet refuses or is empty. It was not asked again: " +
  "a second request would draw on the same faucet. By itself it does not mean a package is broken.";

function notes(options, steps) {
  const lines = failureOfRun(steps)?.faucet ? [FAUCET_NOTE] : [];
  lines.push(...skippedSteps(steps));
  if (options.skipChain) {
    lines.push("The on-chain half was not run (--skip-chain): nothing was deployed or minted.");
  } else if (failureOfRun(steps) && !state.chain?.mintTxHash) {
    lines.push(
      state.chain?.contractAddress
        ? "The run stopped after the deploy: a contract is on chain, and no token was minted."
        : "The run stopped before anything was deployed: there is no contract and no token.",
    );
  }
  for (const note of state.chain?.notes ?? []) lines.push(`From the server: ${note}`);
  if (state.chain?.signer?.source === "env" || state.chain?.deployer?.source === "env") {
    lines.push(
      "Signed with the key in AVAKIT_DEPLOYER_KEY, so the faucet-funded test wallet was not exercised.",
    );
  }
  return [...lines, ...state.warnings];
}

function printSummary(options, steps, result) {
  say();
  say(headline(options, steps, result));
  say();
  const width = Math.max(...steps.map((step) => step.name.length));
  say(`  ${"Step".padEnd(width)}  Result   Seconds`);
  for (const step of steps) {
    say(`  ${step.name.padEnd(width)}  ${step.status.padEnd(7)}  ${seconds(step.ms).padStart(7)}`);
  }
  const failure = failureOfRun(steps);
  if (failure) {
    say();
    say(`  Failed at "${failure.name}": ${failure.reason}`);
  }
  if (packagesLine()) {
    say();
    say(`  Packages: ${packagesLine()}`);
  }
  const rows = chainRows();
  if (rows.length > 0) {
    say();
    say(`  On chain (${CHAIN} testnet):`);
    for (const [label, value, url, remark] of rows) {
      say(`    ${label.padEnd(19)} ${value}${remark}`);
      if (url) say(`    ${"".padEnd(19)} ${url}`);
    }
  }
  for (const note of notes(options, steps)) {
    say();
    say(`  ${note}`);
  }
}

function summaryJson(options, steps, result) {
  return {
    ok: result.ok,
    // Null for a run that passed. `faucet` is true when the step that failed
    // was one that signs and its tool's answer names the faucet.
    failure: failureOfRun(steps),
    source: options.source,
    requestedVersion: options.version ?? null,
    skipChain: options.skipChain,
    startedAt: result.startedAt,
    seconds: Number(seconds(result.ms)),
    environment: state.environment,
    server: state.serverInfo,
    packages: state.packages,
    steps: steps.map((step) => ({
      id: step.id,
      name: step.name,
      status: step.status,
      seconds: Number(seconds(step.ms)),
      detail: step.detail,
      ...(step.output ? { output: step.output } : {}),
    })),
    chain: state.chain,
    notes: notes(options, steps),
  };
}

function summaryMarkdown(options, steps, result) {
  const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\s+/g, " ");
  const linked = (value, url) =>
    typeof url === "string" && /^https:\/\/[^\s()<>]+$/.test(url)
      ? `[\`${value}\`](${url})`
      : `\`${value}\``;
  const lines = [`### ${cell(headline(options, steps, result))}`, ""];
  // Why it failed comes first and in full view, not folded away below the table.
  const failure = failureOfRun(steps);
  if (failure) {
    lines.push(`**Failed at "${cell(failure.name)}":** ${cell(failure.reason)}`, "");
    if (failure.faucet) lines.push(`> ${cell(FAUCET_NOTE)}`, "");
  }
  const remarks = notes(options, steps).filter((note) => note !== FAUCET_NOTE);
  lines.push("| Step | Result | Seconds | Detail |", "| --- | --- | ---: | --- |");
  for (const step of steps) {
    lines.push(
      `| ${cell(step.name)} | ${step.status} | ${seconds(step.ms)} | ${cell(step.detail)} |`,
    );
  }
  if (packagesLine()) lines.push("", `Packages: ${cell(packagesLine())}`);
  const rows = chainRows();
  if (rows.length > 0) {
    lines.push("", `| On chain (${CHAIN} testnet) | |`, "| --- | --- |");
    for (const [label, value, url, remark] of rows) {
      lines.push(`| ${label} | ${linked(value, url)}${cell(remark)} |`);
    }
  }
  for (const note of remarks) lines.push("", cell(note));
  const failed = steps.find((step) => step.status === "failed");
  if (failed?.output) {
    lines.push(
      "",
      `<details><summary>Raw output of the failing step, "${cell(failed.name)}"</summary>`,
      "",
      "````text",
      failed.output.slice(-6_000).replace(/````/g, "` ` ` `"),
      "````",
      "",
      "</details>",
    );
  }
  return `${lines.join("\n")}\n\n`;
}

// ── The run ──────────────────────────────────────────────────────────────────

async function main() {
  let options;
  let limit;
  try {
    options = parseArgs(process.argv.slice(2));
    limit = timeoutSeconds();
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`Error: ${error.message}\n\n${USAGE}`);
    // In a workflow, the version box is where a wrong value comes from: say so
    // where the run is looked at, not only in the log.
    if (IN_ACTIONS) say(`::error title=AvaKit end to end::${oneLine(error.message, 300)}`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  // Output piped into something that stops reading (`| head`) must not crash the
  // run half-way, with children still going.
  process.stdout.on("error", () => {});
  // Whatever ends this process, no child outlives it.
  process.on("exit", () => {
    for (const child of running) stop(child, "SIGKILL");
  });

  const startedAt = new Date().toISOString();
  const started = performance.now();
  const steps = plan(options);

  // Outside this checkout, so npm never picks up the repository's own settings;
  // on a GitHub runner, in the runner's temporary directory.
  const runnerTemp = ENV.RUNNER_TEMP;
  const tempRoot = runnerTemp && existsSync(runnerTemp) ? runnerTemp : os.tmpdir();
  // The real, long path: tools disagree about symlinked and 8.3 temp paths.
  state.workDir = realpathSync.native(mkdtempSync(path.join(tempRoot, "avakit-e2e-")));
  state.appDir = path.join(state.workDir, APP_NAME);

  const half = options.skipChain ? ", without the on-chain half" : "";
  say(
    options.source === "npm"
      ? `AvaKit end to end from npm: ${MCP_PACKAGE}@${options.version}, template ${TEMPLATE}, chain ${CHAIN}${half}`
      : `AvaKit end to end from this checkout: template ${TEMPLATE}, chain ${CHAIN}${half}`,
  );
  say(`Working directory: ${state.workDir}`);
  say();

  // One limit for the whole run. When it passes, or the run is interrupted,
  // every child is stopped and the step that was running fails.
  let cutShort = null;
  let cut;
  const cutPromise = new Promise((_resolve, reject) => {
    cut = (reason) => {
      if (cutShort) return;
      cutShort = reason;
      reject(new StepError(reason.message));
      for (const child of running) stop(child);
    };
  });
  cutPromise.catch(() => {});
  const timer = setTimeout(
    () => cut({ message: `Timed out: the whole run is limited to ${limit} seconds.`, code: 1 }),
    limit * 1000,
  );
  // The children are in process groups of their own, so a Ctrl+C or a closed
  // terminal reaches only this process: it is the one that has to stop them.
  const signals = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  const onSignal = (signal) => cut({ message: `Interrupted (${signal}).`, code: signals[signal] });
  for (const signal of Object.keys(signals)) process.once(signal, onSignal);

  let failed = null;
  for (const step of steps) {
    say(`[ .. ] ${step.name}`);
    const capture = tail(64_000);
    const stepStarted = performance.now();
    try {
      const work = Promise.resolve().then(() => step.action(capture));
      work.catch(() => {});
      const outcome = await Promise.race([work, cutPromise]);
      if (outcome !== null && typeof outcome === "object") {
        step.status = "skipped";
        step.detail = outcome.skipped;
      } else {
        step.status = "passed";
        step.detail = String(outcome ?? "");
      }
    } catch (error) {
      step.status = "failed";
      step.detail = oneLine(error instanceof Error ? error.message : String(error), 1_000);
      // A step that was cut short has no output of its own to report: take what
      // its command had printed so far or, for a tool call, the last error the
      // tool gave and what the server last wrote to stderr. An error that is
      // not a StepError is a bug in this script, and its stack says where.
      const server = state.server;
      step.output = redact(
        (error instanceof StepError ? error.output : error?.stack) ||
          capture.text ||
          (cutShort && [server?.lastReadError, server?.stderr.text].filter(Boolean).join("\n")) ||
          "",
      );
      failed = step;
    }
    step.ms = performance.now() - stepStarted;
    const label = { passed: "PASS", failed: "FAIL", skipped: "SKIP" }[step.status];
    say(`[${label}] ${step.name} (${seconds(step.ms)}s) - ${step.detail}`);
    if (failed) break;
  }
  clearTimeout(timer);

  const noise = state.server?.noise ?? [];
  if (failed) {
    say();
    say(`---- raw output of the failing step, "${failed.name}" ----`);
    // Behind a bar, so that no line of it can pass for a GitHub workflow
    // command: the runner looks for "::" after any leading spaces.
    for (const line of (failed.output.trimEnd() || "(it printed nothing)").split("\n")) {
      say(`    | ${line}`);
    }
    if (noise.length > 0) {
      say("---- lines on the server's stdout that were not JSON-RPC ----");
      for (const line of noise) say(`    | ${line}`);
    }
    say("---- end ----");
    if (IN_ACTIONS) {
      const title = isFaucetFailure(failed)
        ? "AvaKit end to end - the faucet did not fund the test wallet"
        : "AvaKit end to end";
      say(`::error title=${title}::${failed.name}: ${oneLine(failed.detail, 300)}`);
    }
  } else if (noise.length > 0) {
    state.warnings.push(
      `The server wrote ${noise.length} line(s) to stdout that are not JSON-RPC, which a stricter client may reject. The first: ${oneLine(noise[0], 200)}`,
    );
  }

  // Stop what is still running, then tidy up. A run that was cut short has
  // already told every child to stop; otherwise the server is ended the way a
  // client ends it, and it should go by itself.
  if (state.server && !cutShort && !(await state.server.close()) && !failed) {
    state.warnings.push(
      `The MCP server did not exit within ${SERVER_EXIT_GRACE_MS / 1000} seconds of its stdin closing, and was stopped.`,
    );
  }
  await stopEverything();
  if (options.keep) {
    say();
    say(`Kept: ${state.workDir}`);
  } else {
    try {
      rmSync(state.workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error) {
      state.warnings.push(`Could not remove ${state.workDir}: ${error.message}`);
    }
  }

  const result = { ok: failed === null, ms: performance.now() - started, startedAt };
  printSummary(options, steps, result);
  if (options.json) {
    const file = path.resolve(options.json);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      redact(`${JSON.stringify(summaryJson(options, steps, result), null, 2)}\n`),
    );
    say();
    say(`Summary written to ${file}`);
  }
  if (ENV.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(ENV.GITHUB_STEP_SUMMARY, redact(summaryMarkdown(options, steps, result)));
    } catch (error) {
      say(`Could not write the step summary: ${error.message}`);
    }
  }
  if (failed) return cutShort?.code ?? 1;
  return 0;
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
      process.stderr.write(`${redact(error?.stack ?? String(error))}\n`);
      process.exit(1);
    },
  );
}

// For scripts/e2e-fuji.test.mjs. Nothing here starts a run.
export {
  artifactPaths,
  FAUCET_NOTE,
  isFaucetFailure,
  lineSplitter,
  McpClient,
  missingTools,
  parseArgs,
  publishedVersions,
  REQUIRED_TOOLS,
  StepError,
  satisfies,
  siblingUrl,
  spawnNode,
  UsageError,
};
