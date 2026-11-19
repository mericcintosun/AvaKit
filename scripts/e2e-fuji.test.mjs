// scripts/e2e-fuji.mjs, checked without the network, without a chain and
// without the real MCP server.
//
// Two kinds of test. The parts with no side effects (the arguments, the version
// ranges, the JSON-RPC client) are imported and called. The run as a whole is
// started as a process, on a copy of the script in a fake repo: its MCP server
// is a stand-in that answers the tools of the flow with canned results, and
// `npm` and `npx` on its PATH are stand-ins too. Everything they are asked is
// written down, so a test can say what was called, with what, in which
// directory and with which environment. Nothing here can reach npm, the faucet
// or an RPC: no part of it knows an address to send anything to.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
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
} from "./e2e-fuji.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "e2e-fuji.mjs");
const workflows = join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows");
// The stand-ins for npm and npx are shell scripts.
const skip = process.platform === "win32";

// ── The stand-ins ────────────────────────────────────────────────────────────

/**
 * An MCP server over stdio that answers the tools of the flow. `E2E_STUB` (JSON)
 * says how it should misbehave; every call it receives is appended to the file
 * `E2E_RECORD` names, one JSON document per line.
 */
const STUB_SERVER = `
const { appendFileSync, mkdirSync, writeFileSync } = require("node:fs");
const { randomBytes } = require("node:crypto");
const path = require("node:path");

const options = JSON.parse(process.env.E2E_STUB || "{}");
const record = (entry) => {
  if (process.env.E2E_RECORD) appendFileSync(process.env.E2E_RECORD, JSON.stringify(entry) + "\\n");
};
const hex = (bytes) => "0x" + randomBytes(bytes).toString("hex");
const signer = hex(20);
const contract = hex(20);
const deployTx = hex(32);
const mintTx = hex(32);
const explorer = "https://explorer.example/fuji";
let reads = 0;

record({
  who: "server",
  pid: process.pid,
  cwd: process.cwd(),
  doNotTrack: process.env.DO_NOT_TRACK ?? null,
  telemetryDisabled: process.env.AVAKIT_TELEMETRY_DISABLED ?? null,
  allowMainnet: process.env.AVAKIT_ALLOW_MAINNET ?? null,
  mcpRoot: process.env.AVAKIT_MCP_ROOT ?? null,
  hasDeployerKey: process.env.AVAKIT_DEPLOYER_KEY !== undefined,
  signer,
  contract,
  deployTx,
  mintTx,
});

// One message per line. Written in two pieces when asked to, so that the
// client has to put a line back together.
let queue = Promise.resolve();
function send(message) {
  const line = JSON.stringify(message) + "\\n";
  queue = queue.then(
    () =>
      new Promise((resolve) => {
        if (!options.chunked) return process.stdout.write(line, () => resolve());
        const middle = Math.floor(line.length / 2);
        process.stdout.write(line.slice(0, middle));
        setTimeout(() => process.stdout.write(line.slice(middle), () => resolve()), 5);
      }),
  );
}
const ok = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const failed = (text) => ({ content: [{ type: "text", text }], isError: true });

function call(name, args) {
  record({ who: "tool", name, args });
  if (name === "scaffold_app") {
    const app = path.join(process.cwd(), args.name);
    mkdirSync(path.join(app, "lib"), { recursive: true });
    writeFileSync(
      path.join(app, "package.json"),
      JSON.stringify({
        name: args.name,
        scripts: { build: "next build" },
        dependencies: { "@avakit/core": "^0.2.1", "@avakit/react": "^0.2.1" },
      }),
    );
    writeFileSync(path.join(app, "lib", "nft-artifact.ts"), "export const abi = [];\\n");
    return ok({
      path: app,
      filesCreated: 2,
      files: ["package.json", "lib/nft-artifact.ts"],
      ...(options.noArtifacts ? {} : { artifacts: [args.name + "/lib/nft-artifact.ts"] }),
      nextSteps: ["cd " + args.name],
    });
  }
  if (name === "wallet_status") {
    return ok({
      address: signer,
      source: "session",
      chain: options.walletChain ?? "fuji",
      balanceWei: "0",
      balanceAvax: "0",
    });
  }
  if (name === "deploy_contract") {
    if (options.deployError) {
      return failed(
        options.echoKey
          ? options.deployError + " " + process.env.AVAKIT_DEPLOYER_KEY
          : options.deployError,
      );
    }
    return ok({
      address: contract,
      txHash: deployTx,
      explorerUrl: explorer + "/address/" + contract,
      signer: { address: signer, source: "session" },
      note: "The session wallet was funded by the faucet.",
    });
  }
  if (name === "write_contract") {
    if (options.mintError) return failed(options.mintError);
    return ok({
      txHash: mintTx,
      status: "success",
      blockNumber: 4242,
      explorerUrl: explorer + "/tx/" + mintTx,
      signer: { address: signer, source: "session" },
    });
  }
  if (name === "read_chain") {
    reads++;
    if (reads <= (options.readFailures ?? 0)) return failed("read_chain failed: the node is behind");
    return ok(options.wrongOwner ? hex(20) : signer);
  }
  return failed("Unknown tool " + name);
}

function receive(message) {
  if (message.id === "ping-1") return record({ who: "pong", result: message.result ?? null });
  if (message.method === "initialize") {
    if (options.hang) return;
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "stub-mcp", version: options.version ?? "9.9.9" },
      },
    });
    if (options.ping) send({ jsonrpc: "2.0", id: "ping-1", method: "ping" });
    return;
  }
  if (message.method === "notifications/initialized") return record({ who: "initialized" });
  if (message.method === "tools/list") {
    const names = options.tools ?? [
      "list_templates",
      "scaffold_app",
      "read_chain",
      "deploy_contract",
      "write_contract",
      "wallet_status",
    ];
    return send({ jsonrpc: "2.0", id: message.id, result: { tools: names.map((name) => ({ name })) } });
  }
  if (message.method === "tools/call") {
    if (options.dieOnCall) process.exit(3);
    const { name, arguments: args } = message.params;
    return send({ jsonrpc: "2.0", id: message.id, result: call(name, args) });
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
}

if (options.noise) process.stdout.write("starting up, please wait\\n");
process.stderr.write("stub-mcp running on stdio\\n");
let rest = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  const lines = (rest + chunk).split("\\n");
  rest = lines.pop();
  for (const line of lines) if (line.trim()) receive(JSON.parse(line));
});
process.stdin.on("end", () => queue.then(() => process.exit(0)));
`;

/**
 * What `npm` and `npx` are during a run: `node fake-npm.cjs npm|npx <args>`.
 * `npx` becomes the stub server; `npm` answers the few commands the script has.
 */
const FAKE_NPM = `
const { appendFileSync, mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const [tool, ...args] = process.argv.slice(2);
const options = JSON.parse(process.env.E2E_FAKE_NPM || "{}");
appendFileSync(
  process.env.E2E_RECORD,
  JSON.stringify({
    who: tool,
    args,
    cwd: process.cwd(),
    doNotTrack: process.env.DO_NOT_TRACK ?? null,
    telemetryDisabled: process.env.AVAKIT_TELEMETRY_DISABLED ?? null,
    hasDeployerKey: process.env.AVAKIT_DEPLOYER_KEY !== undefined,
    npmConfigPackage: process.env.npm_config_package ?? null,
  }) + "\\n",
);

if (tool === "npx") {
  require(process.env.E2E_STUB_SERVER);
} else if (args[0] === "--version") {
  console.log("99.0.0");
} else if (args[0] === "view") {
  const versions = (options.published ?? {})[args[1]];
  if (!versions) {
    console.log(JSON.stringify({ error: { code: "E404", summary: "Not found" } }));
    process.exit(1);
  }
  console.log(JSON.stringify(versions));
} else if (args[0] === "install") {
  if (options.installFails) {
    console.error("npm error code ERESOLVE");
    process.exit(1);
  }
  for (const name of ["core", "react"]) {
    const dir = path.join(process.cwd(), "node_modules", "@avakit", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "0.2.3" }));
  }
  console.log("added 2 packages");
} else if (args[0] === "run" && args[1] === "build") {
  console.log("build complete");
} else {
  console.error("fake npm: unexpected " + args.join(" "));
  process.exit(64);
}
`;

/** The fake repo: a copy of the script, a stub server where the build would be, fake npm and npx. */
function fakeRepo(t) {
  // The real path: the script reports directories by theirs.
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), "avakit-e2e-test-")));
  t.after(() => rmSync(repo, { recursive: true, force: true, maxRetries: 5 }));

  mkdirSync(join(repo, "scripts"));
  cpSync(script, join(repo, "scripts", "e2e-fuji.mjs"));
  mkdirSync(join(repo, "packages", "mcp", "dist"), { recursive: true });
  // The stand-ins are CommonJS wherever the temporary directory happens to live.
  writeFileSync(join(repo, "package.json"), JSON.stringify({ type: "commonjs" }));
  const server = join(repo, "packages", "mcp", "dist", "index.js");
  writeFileSync(server, STUB_SERVER);
  writeFileSync(join(repo, "fake-npm.cjs"), FAKE_NPM);
  mkdirSync(join(repo, "bin"));
  for (const tool of ["npm", "npx"]) {
    const file = join(repo, "bin", tool);
    writeFileSync(
      file,
      `#!/bin/sh\nexec "${process.execPath}" "${join(repo, "fake-npm.cjs")}" ${tool} "$@"\n`,
    );
    chmodSync(file, 0o755);
  }
  mkdirSync(join(repo, "tmp"));
  return { repo, server, record: join(repo, "record.jsonl"), temp: join(repo, "tmp") };
}

/**
 * Run the copy of the script and return how it ended and what was recorded.
 *
 * @param {object} [options]
 * @param {object} [options.stub] How the stub server behaves.
 * @param {object} [options.npm] How the fake npm behaves.
 * @param {Record<string, string | undefined>} [options.env] On top of the run's environment.
 * @param {{ after: RegExp, signal: NodeJS.Signals }} [options.interrupt] Send the run a signal
 *   once its output matches.
 */
async function e2e(t, args, { stub = {}, npm = {}, env = {}, fake = fakeRepo(t), interrupt } = {}) {
  const childEnv = {
    ...process.env,
    PATH: [join(fake.repo, "bin"), dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
    E2E_STUB: JSON.stringify(stub),
    E2E_FAKE_NPM: JSON.stringify(npm),
    E2E_RECORD: fake.record,
    E2E_STUB_SERVER: fake.server,
    // Where the script makes its working directory, so a test can look for leftovers.
    RUNNER_TEMP: fake.temp,
    // Whatever this test run is inside of (GitHub Actions, a shell with a key
    // in it) is not what the script under test should see.
    GITHUB_ACTIONS: undefined,
    GITHUB_STEP_SUMMARY: undefined,
    AVAKIT_DEPLOYER_KEY: undefined,
    AVAKIT_ALLOW_MAINNET: undefined,
    AVAKIT_MCP_ROOT: undefined,
    AVAKIT_E2E_TIMEOUT_SECONDS: "60",
    ...env,
  };
  for (const [name, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[name];
  }
  const summaryFile = join(fake.repo, "summary.json");
  const child = spawn(
    process.execPath,
    [join(fake.repo, "scripts", "e2e-fuji.mjs"), ...args, "--json", summaryFile],
    { cwd: fake.repo, env: childEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  let interrupted = false;
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
    if (interrupt && !interrupted && interrupt.after.test(stdout)) {
      interrupted = true;
      child.kill(interrupt.signal);
    }
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(code ?? signal));
  });
  const recorded = existsSync(fake.record)
    ? readFileSync(fake.record, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  return {
    status,
    stdout,
    stderr,
    recorded,
    fake,
    summary: existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, "utf8")) : null,
    calls: recorded.filter((entry) => entry.who === "tool"),
    server: recorded.find((entry) => entry.who === "server"),
    leftovers: readdirSync(fake.temp),
  };
}

const toolNames = (run) => run.calls.map((call) => call.name);
const stepStatus = (run) =>
  Object.fromEntries(run.summary.steps.map((step) => [step.id, step.status]));

// ── The arguments ────────────────────────────────────────────────────────────

test("the arguments name a source, and npm defaults to the latest version", () => {
  assert.deepEqual(parseArgs(["--source", "npm"]), {
    source: "npm",
    version: "latest",
    skipChain: false,
    keep: false,
  });
  assert.deepEqual(parseArgs(["--source=workspace", "--skip-chain", "--keep"]), {
    source: "workspace",
    version: undefined,
    skipChain: true,
    keep: true,
  });
  const full = parseArgs(["--source", "npm", "--version=0.1.28", "--json", "out/summary.json"]);
  assert.equal(full.version, "0.1.28");
  assert.equal(full.json, "out/summary.json");
  assert.deepEqual(parseArgs(["--help"]), { help: true });
});

test("the arguments refuse what they do not understand", () => {
  const refused = [
    [[], /Say what to test/],
    [["--source", "github"], /Unknown source "github"/],
    [["--source"], /--source needs a value/],
    [["--source", "npm", "--version"], /--version needs a value/],
    [["--source", "npm", "--version", "--keep"], /--version needs a value/],
    [["--source", "workspace", "--version", "1.0.0"], /only applies to --source npm/],
    [["--source", "npm", "--skip-chain=yes"], /does not take a value/],
    [["--source", "npm", "--chain", "c-chain"], /Unknown option "--chain"/],
    [["--source", "npm", "--json="], /--json needs a file name/],
    [["--source", "npm", "extra"], /Unknown option "extra"/],
  ];
  for (const [argv, message] of refused) {
    assert.throws(
      () => parseArgs(argv),
      (error) => {
        assert.ok(error instanceof UsageError, argv.join(" "));
        assert.match(error.message, message);
        return true;
      },
    );
  }
});

test("--version takes a version or a dist-tag and nothing a shell or npm could read more into", () => {
  for (const version of ["latest", "next", "0.1.28", "1.0.0-rc.1", "0.2.0_beta"]) {
    assert.equal(parseArgs(["--source", "npm", "--version", version]).version, version);
  }
  for (const version of [
    "^0.1.0",
    ">=1",
    "1.0.0 || 2",
    "latest; echo pwned",
    "$(id)",
    "../mcp",
    "file:../mcp",
    "https://example.com/mcp.tgz",
    "github:user/repo",
    "@scope/pkg",
    "-rf",
    "",
    "a".repeat(65),
  ]) {
    assert.throws(
      () => parseArgs(["--source", "npm", `--version=${version}`]),
      (error) => error instanceof UsageError && /Invalid --version/.test(error.message),
      version,
    );
  }
});

// ── The small parts ──────────────────────────────────────────────────────────

test("a pin is satisfied by the versions npm would install for it", () => {
  // The scaffolder writes ^x.y.z, and for 0.x a caret stays inside the minor.
  assert.equal(satisfies("0.2.1", "^0.2.1"), true);
  assert.equal(satisfies("0.2.9", "^0.2.1"), true);
  assert.equal(satisfies("0.2.0", "^0.2.1"), false);
  assert.equal(satisfies("0.3.0", "^0.2.1"), false);
  assert.equal(satisfies("1.4.0", "^1.2.3"), true);
  assert.equal(satisfies("2.0.0", "^1.2.3"), false);
  assert.equal(satisfies("0.0.4", "^0.0.3"), false);
  assert.equal(satisfies("0.0.3", "^0.0.3"), true);
  assert.equal(satisfies("0.2.1", "0.2.1"), true);
  assert.equal(satisfies("0.2.2", "0.2.1"), false);
  // A prerelease is not what `npm install` picks for a caret range.
  assert.equal(satisfies("0.2.2-next.0", "^0.2.1"), false);
  assert.throws(() => satisfies("0.2.1", "workspace:*"), StepError);
  assert.throws(() => satisfies("0.2.1", ">=0.2 <1"), StepError);
});

test("the published versions are read from whatever shape npm prints them in", () => {
  const core = "@avakit/core";
  const answer = (stdout, code = 0, output = stdout) => ({ stdout, code, output });
  assert.deepEqual(publishedVersions(core, answer('["0.2.0","0.2.1","0.3.0-next.1"]')), [
    "0.2.0",
    "0.2.1",
  ]);
  assert.deepEqual(publishedVersions(core, answer('"0.2.1"')), ["0.2.1"]);
  assert.deepEqual(publishedVersions(core, answer('[{"versions":["0.2.0","0.2.1"]}]')), [
    "0.2.0",
    "0.2.1",
  ]);
  // Not on the registry at all: no versions, and not an error.
  assert.deepEqual(publishedVersions(core, answer('{"error":{"code":"E404"}}', 1)), []);
  assert.deepEqual(publishedVersions(core, answer("", 1, "npm error code E404\n")), []);
  // The registry could not be asked: that is not "unpublished".
  assert.throws(
    () => publishedVersions(core, answer("", 1, "npm error code ENOTFOUND\n")),
    (error) => error instanceof StepError && /Could not ask npm/.test(error.message),
  );
  assert.throws(() => publishedVersions(core, answer("<html>", 0)), StepError);
});

test("the artifact path is taken from any shape `artifacts` may have", () => {
  const file = "app/lib/nft-artifact.ts";
  assert.deepEqual(artifactPaths([file]), [file]);
  assert.deepEqual(artifactPaths([{ contract: "AvaKitNFT", path: file }]), [file]);
  assert.deepEqual(artifactPaths([{ name: "AvaKitNFT", artifactPath: file }]), [file]);
  assert.deepEqual(artifactPaths({ AvaKitNFT: file, Other: "app/out/Other.json" }), [
    file,
    "app/out/Other.json",
  ]);
  // Nothing to deploy from: not a list, or names that are not files.
  for (const nothing of [undefined, null, [], {}, "AvaKitNFT", ["AvaKitNFT"], 7]) {
    assert.deepEqual(artifactPaths(nothing), []);
  }
});

test("every tool of the flow is required, whichever half a run stops after", () => {
  assert.deepEqual([...REQUIRED_TOOLS].sort(), [
    "deploy_contract",
    "read_chain",
    "scaffold_app",
    "wallet_status",
    "write_contract",
  ]);
  assert.deepEqual(missingTools([...REQUIRED_TOOLS, "get_context"]), []);
  // The server as it was before it could mint.
  assert.deepEqual(
    missingTools(["list_templates", "scaffold_app", "read_chain", "deploy_contract"]),
    ["write_contract", "wallet_status"],
  );
  assert.deepEqual(missingTools([]), REQUIRED_TOOLS);
});

test("the transaction link is the explorer's page next to the contract's", () => {
  const address = "0xAbC0000000000000000000000000000000000001";
  const tx = `0x${"12".repeat(32)}`;
  assert.equal(
    siblingUrl(`https://explorer.example/address/${address}`, `/address/${address}`, `/tx/${tx}`),
    `https://explorer.example/tx/${tx}`,
  );
  // The explorer may spell the address in another case than the tool does.
  assert.equal(
    siblingUrl(
      `https://explorer.example/address/${address.toLowerCase()}`,
      `/address/${address}`,
      `/tx/${tx}`,
    ),
    `https://explorer.example/tx/${tx}`,
  );
  assert.equal(
    siblingUrl("https://explorer.example/token/1", `/address/${address}`, "/tx/1"),
    null,
  );
  assert.equal(siblingUrl(undefined, "/address/x", "/tx/1"), null);
});

test("a faucet failure is a signing step whose answer names the faucet", () => {
  const refusal = "the AvaKit faucet did not fund it: it is out of test AVAX";
  assert.equal(isFaucetFailure({ id: "deploy", detail: refusal, output: "" }), true);
  assert.equal(isFaucetFailure({ id: "mint", detail: "error", output: `...\n${refusal}` }), true);
  assert.equal(isFaucetFailure({ id: "deploy", detail: "execution reverted", output: "" }), false);
  // A step that never signs cannot have been refused by the faucet.
  assert.equal(isFaucetFailure({ id: "install", detail: refusal, output: refusal }), false);
  assert.equal(isFaucetFailure({ id: "verify", detail: refusal, output: "" }), false);
});

test("lines are put back together from chunks that end anywhere", () => {
  const lines = [];
  const splitter = lineSplitter((line) => lines.push(line));
  splitter.feed('{"a":');
  splitter.feed('1}\n{"b":2}\r\n{"c"');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  splitter.feed(":3}");
  splitter.flush();
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
  splitter.flush();
  assert.equal(lines.length, 3);
});

// ── The JSON-RPC client ──────────────────────────────────────────────────────

/** A client connected to the stub server. Its conversation is kept, not printed. */
function connect(t, stub = {}) {
  const dir = mkdtempSync(join(tmpdir(), "avakit-e2e-client-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "commonjs" }));
  const server = join(dir, "server.js");
  writeFileSync(server, STUB_SERVER);
  const record = join(dir, "record.jsonl");
  const child = spawnNode(server, {
    cwd: dir,
    env: { ...process.env, E2E_STUB: JSON.stringify(stub), E2E_RECORD: record },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const log = [];
  const client = new McpClient(child, { readRetryMs: 5, log: (line) => log.push(line) });
  t.after(() => client.close());
  const recorded = () =>
    readFileSync(record, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return { client, log, recorded, calls: () => recorded().filter((entry) => entry.who === "tool") };
}

const HELLO = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test", version: "1.0.0" },
};

test("the client speaks one JSON-RPC message per line, however the lines arrive", async (t) => {
  const { client, recorded } = connect(t, { chunked: true, noise: true, ping: true });

  const hello = await client.request("initialize", HELLO);
  assert.equal(hello.serverInfo.name, "stub-mcp");
  assert.equal(hello.protocolVersion, "2025-06-18");
  client.notify("notifications/initialized");
  const list = await client.request("tools/list");
  assert.ok(list.tools.some((tool) => tool.name === "write_contract"));

  const { data, attempts } = await client.callJsonTool("wallet_status", { chain: "fuji" });
  assert.equal(data.source, "session");
  assert.equal(attempts, 1);

  assert.equal(await client.close(), true, "the server exits when its stdin closes");
  // What was not JSON-RPC is set aside, not parsed and not fatal.
  assert.deepEqual(client.noise, ["starting up, please wait"]);
  const seen = recorded();
  // The server's ping was answered, and the notification reached it.
  assert.deepEqual(
    seen.find((entry) => entry.who === "pong"),
    { who: "pong", result: {} },
  );
  assert.ok(seen.some((entry) => entry.who === "initialized"));
  assert.deepEqual(
    seen.filter((entry) => entry.who === "tool"),
    [{ who: "tool", name: "wallet_status", args: { chain: "fuji" } }],
  );
});

test("a JSON-RPC error and a tool's own error both reject, with what the server said", async (t) => {
  const { client, calls } = connect(t, { deployError: "deploy failed: execution reverted" });
  await client.request("initialize", HELLO);

  await assert.rejects(client.request("resources/list"), (error) => {
    assert.ok(error instanceof StepError);
    assert.match(error.message, /answered "resources\/list" with a JSON-RPC error/);
    assert.match(error.output, /Method not found/);
    return true;
  });

  await assert.rejects(client.callJsonTool("deploy_contract", { chain: "fuji" }), (error) => {
    assert.ok(error instanceof StepError);
    assert.equal(
      error.message,
      "deploy_contract reported an error: deploy failed: execution reverted",
    );
    assert.equal(error.output, "deploy failed: execution reverted");
    return true;
  });
  // A tool that signs is asked once, whatever it answers.
  assert.equal(calls().length, 1);
});

test("a tool that only reads is asked again, a limited number of times", async (t) => {
  const behind = connect(t, { readFailures: 2 });
  await behind.client.request("initialize", HELLO);
  const answer = await behind.client.callTool("read_chain", {}, { readOnly: true });
  assert.equal(answer.attempts, 3);
  assert.equal(behind.calls().length, 3);
  assert.equal(behind.client.lastReadError, "read_chain failed: the node is behind");

  const down = connect(t, { readFailures: 99 });
  await down.client.request("initialize", HELLO);
  await assert.rejects(down.client.callTool("read_chain", {}, { readOnly: true }), (error) => {
    assert.equal(
      error.message,
      "read_chain reported an error (asked 4 times): read_chain failed: the node is behind",
    );
    return true;
  });
  assert.equal(down.calls().length, 4);

  // The same failing tool, not marked as a read: one call and no more.
  const signing = connect(t, { readFailures: 99 });
  await signing.client.request("initialize", HELLO);
  await assert.rejects(signing.client.callTool("read_chain", {}));
  assert.equal(signing.calls().length, 1);
});

test("a server that dies fails the request that was waiting for it", async (t) => {
  const { client } = connect(t, { dieOnCall: true });
  await client.request("initialize", HELLO);
  await assert.rejects(client.callTool("wallet_status", {}), (error) => {
    assert.ok(error instanceof StepError);
    assert.match(error.message, /The process ended \(exit code 3\)/);
    assert.match(error.output, /stub-mcp running on stdio/);
    return true;
  });
  // And every request after it, at once.
  await assert.rejects(client.request("tools/list"), /The process ended/);
});

// ── The run as a whole ───────────────────────────────────────────────────────

test("started directly, the script runs: usage errors exit 2 and --help exits 0", {
  skip,
}, async () => {
  const start = (args) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [script, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("close", (status) => resolve({ status, stdout, stderr }));
    });

  const help = await start(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage:\n {2}node scripts\/e2e-fuji\.mjs --source npm/);

  const none = await start([]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /^Error: Say what to test/);
  assert.match(none.stderr, /Usage:/);

  const mainnet = await start(["--source", "npm", "--chain", "c-chain"]);
  assert.equal(mainnet.status, 2, "the chain is not an option");
});

test("from npm: scaffold, install, build, deploy, mint and confirm, as an agent would", {
  skip,
}, async (t) => {
  const key = `0x${randomBytes(32).toString("hex")}`;
  const fake = fakeRepo(t);
  const stepSummary = join(fake.repo, "step-summary.md");
  const run = await e2e(t, ["--source", "npm", "--version", "1.2.3"], {
    fake,
    stub: { version: "1.2.3", chunked: true },
    env: {
      AVAKIT_DEPLOYER_KEY: key,
      AVAKIT_ALLOW_MAINNET: "1",
      AVAKIT_MCP_ROOT: "/somewhere/else",
      GITHUB_STEP_SUMMARY: stepSummary,
    },
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);

  // The server came from npx, with the version as an argument of its own.
  const npx = run.recorded.find((entry) => entry.who === "npx");
  assert.deepEqual(npx.args, ["--yes", "@avakit/mcp@1.2.3"]);

  // It ran in the working directory, could not sign for mainnet, and no child
  // of the run counts as adoption.
  const workDir = npx.cwd;
  assert.equal(run.server.cwd, workDir);
  assert.equal(run.server.allowMainnet, null);
  assert.equal(run.server.mcpRoot, null);
  assert.equal(run.server.hasDeployerKey, true);
  const children = run.recorded.filter((entry) => ["server", "npm", "npx"].includes(entry.who));
  assert.ok(children.length >= 5);
  for (const child of children) {
    assert.equal(child.doNotTrack, "1", JSON.stringify(child));
    assert.equal(child.telemetryDisabled, "1");
  }

  // Exactly the calls of the flow, with what the tools themselves returned.
  const { signer, contract, deployTx, mintTx } = run.server;
  const artifactPath = "e2e-nft-mint/lib/nft-artifact.ts";
  assert.deepEqual(
    run.calls.map(({ name, args }) => ({ name, args })),
    [
      { name: "scaffold_app", args: { name: "e2e-nft-mint", template: "nft-mint", chain: "fuji" } },
      { name: "wallet_status", args: { chain: "fuji" } },
      { name: "deploy_contract", args: { artifactPath, chain: "fuji" } },
      {
        name: "write_contract",
        args: { address: contract, artifactPath, functionName: "mint", chain: "fuji" },
      },
      {
        name: "read_chain",
        args: {
          action: "contractRead",
          chain: "fuji",
          address: contract,
          abi: run.calls.at(-1).args.abi,
          functionName: "ownerOf",
          args: [1],
        },
      },
    ],
  );
  assert.equal(run.calls.at(-1).args.abi[0].name, "ownerOf");

  // npm installed and built the app, in the app, without the deployer key.
  const npm = run.recorded.filter((entry) => entry.who === "npm");
  assert.deepEqual(
    npm.map((entry) => entry.args.join(" ")),
    ["--version", "install", "run build"],
  );
  for (const entry of npm.slice(1)) assert.equal(entry.cwd, join(workDir, "e2e-nft-mint"));
  for (const entry of npm) assert.equal(entry.hasDeployerKey, false, entry.args.join(" "));

  // The summary: every step, both transactions with their links, the signer.
  assert.deepEqual(stepStatus(run), {
    environment: "passed",
    server: "passed",
    tools: "passed",
    scaffold: "passed",
    install: "passed",
    build: "passed",
    artifact: "passed",
    wallet: "passed",
    deploy: "passed",
    mint: "passed",
    verify: "passed",
  });
  const { summary } = run;
  assert.equal(summary.ok, true);
  assert.equal(summary.failure, null);
  assert.equal(summary.source, "npm");
  assert.equal(summary.requestedVersion, "1.2.3");
  assert.equal(summary.environment.node, process.versions.node);
  assert.equal(summary.environment.npm, "99.0.0");
  assert.deepEqual(summary.packages, {
    "@avakit/mcp": "1.2.3",
    "@avakit/core": "0.2.3",
    "@avakit/react": "0.2.3",
  });
  assert.deepEqual(summary.chain, {
    network: "fuji",
    artifactPath,
    walletBefore: { address: signer, source: "session", balanceAvax: "0" },
    contractAddress: contract,
    contractUrl: `https://explorer.example/fuji/address/${contract}`,
    deployTxHash: deployTx,
    deployTxUrl: `https://explorer.example/fuji/tx/${deployTx}`,
    deployer: { address: signer, source: "session" },
    notes: ["The session wallet was funded by the faucet."],
    mintTxHash: mintTx,
    mintTxUrl: `https://explorer.example/fuji/tx/${mintTx}`,
    mintBlock: 4242,
    signer: { address: signer, source: "session" },
    ownerOfToken1: signer,
  });
  for (const step of summary.steps) assert.equal(typeof step.seconds, "number");

  assert.match(run.stdout, /AvaKit end to end PASSED in [\d.]+s: the published packages/);
  assert.match(run.stdout, new RegExp(`Signer +${signer} \\(session\\)`));
  const markdown = readFileSync(stepSummary, "utf8");
  assert.match(markdown, /^### AvaKit end to end PASSED/);
  assert.match(markdown, /\| Deploy the contract \| passed \| [\d.]+ \|/);
  assert.ok(
    markdown.includes(
      `| Mint transaction | [\`${mintTx}\`](https://explorer.example/fuji/tx/${mintTx}) |`,
    ),
  );
  assert.ok(markdown.includes(`| Signer | \`${signer}\` (session) |`));

  // The key went to the server and nowhere a reader could find it.
  for (const text of [run.stdout, run.stderr, markdown, JSON.stringify(summary)]) {
    assert.ok(!text.includes(key.slice(2)));
  }
  // And the working directory is gone.
  assert.deepEqual(run.leftovers, []);
  assert.equal(existsSync(workDir), false);
});

test("--skip-chain stops after the build and calls no tool that signs", { skip }, async (t) => {
  const run = await e2e(t, ["--source", "npm", "--skip-chain"]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(toolNames(run), ["scaffold_app"]);
  assert.deepEqual(Object.keys(stepStatus(run)), [
    "environment",
    "server",
    "tools",
    "scaffold",
    "install",
    "build",
  ]);
  assert.equal(run.summary.chain, null);
  // "latest" is what npx is asked for when no version is given.
  assert.deepEqual(run.recorded.find((entry) => entry.who === "npx").args, [
    "--yes",
    "@avakit/mcp@latest",
  ]);
  assert.match(run.stdout, /PASSED in [\d.]+s \(on-chain half not run\)/);
  assert.match(run.stdout, /The on-chain half was not run \(--skip-chain\)/);
});

test("a server without every tool of the flow fails the run, with its list printed", {
  skip,
}, async (t) => {
  // What @avakit/mcp listed before it could mint.
  const tools = ["list_templates", "scaffold_app", "read_chain", "estimate_gas", "deploy_contract"];
  for (const args of [
    ["--source", "npm"],
    ["--source", "npm", "--skip-chain"],
  ]) {
    const run = await e2e(t, args, { stub: { tools } });
    assert.equal(run.status, 1, args.join(" "));
    assert.deepEqual(toolNames(run), [], "nothing is scaffolded on a server that cannot finish");
    assert.equal(run.summary.failure.step, "tools");
    assert.equal(
      run.summary.failure.reason,
      "The server has no write_contract, wallet_status. The flow needs: scaffold_app, " +
        "deploy_contract, write_contract, read_chain, wallet_status.",
    );
    assert.ok(run.stdout.includes(`The server lists 5 tools: ${tools.join(", ")}`));
    assert.match(run.stdout, /AvaKit end to end FAILED/);
    assert.deepEqual(run.leftovers, []);
  }
});

test("a faucet that refuses fails the run with its reason, and is not asked again", {
  skip,
}, async (t) => {
  const refusal =
    "The session wallet has no test AVAX and the AvaKit faucet did not fund it: it is out of test AVAX.";
  const fake = fakeRepo(t);
  const stepSummary = join(fake.repo, "step-summary.md");
  const run = await e2e(t, ["--source", "npm"], {
    fake,
    stub: { deployError: refusal },
    env: { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: stepSummary },
  });

  assert.equal(run.status, 1);
  // One request to deploy, so at most one request to the faucet; and no mint.
  assert.deepEqual(toolNames(run), ["scaffold_app", "wallet_status", "deploy_contract"]);
  assert.deepEqual(run.summary.failure, {
    step: "deploy",
    name: "Deploy the contract",
    reason: `deploy_contract reported an error: ${refusal}`,
    faucet: true,
  });
  assert.equal(run.summary.ok, false);
  assert.equal(stepStatus(run).deploy, "failed");
  assert.equal(stepStatus(run).mint, "not run");
  assert.equal(stepStatus(run).verify, "not run");
  assert.ok(run.summary.notes.includes(FAUCET_NOTE));
  assert.ok(
    run.summary.notes.includes(
      "The run stopped before anything was deployed: there is no contract and no token.",
    ),
  );

  // The reason is in the job's summary in full view, above the table.
  const markdown = readFileSync(stepSummary, "utf8");
  assert.match(markdown, /^### AvaKit end to end FAILED/);
  const reasonAt = markdown.indexOf(
    `**Failed at "Deploy the contract":** deploy_contract reported an error: ${refusal}`,
  );
  assert.ok(reasonAt > 0, markdown);
  assert.ok(markdown.indexOf(`> ${FAUCET_NOTE}`) > reasonAt);
  assert.ok(markdown.indexOf("| Step | Result |") > reasonAt);
  assert.ok(markdown.includes(`| Deploy the contract | failed |`));

  // And in the log: the raw answer, and an annotation that names the faucet.
  assert.ok(run.stdout.includes(`    | ${refusal}`));
  assert.ok(
    run.stdout.includes(
      `::error title=AvaKit end to end - the faucet did not fund the test wallet::Deploy the contract: deploy_contract reported an error: ${refusal}`,
    ),
  );
  assert.ok(run.stdout.includes(`Failed at "Deploy the contract": deploy_contract reported`));
  assert.deepEqual(run.leftovers, []);
});

test("a failure that is not the faucet's is not blamed on it", { skip }, async (t) => {
  const run = await e2e(t, ["--source", "npm"], {
    stub: { mintError: 'write_contract failed: the call reverted with "AvaKitNFT: sold out"' },
  });
  assert.equal(run.status, 1);
  assert.deepEqual(toolNames(run), [
    "scaffold_app",
    "wallet_status",
    "deploy_contract",
    "write_contract",
  ]);
  assert.equal(run.summary.failure.step, "mint");
  assert.equal(run.summary.failure.faucet, false);
  assert.ok(!run.summary.notes.includes(FAUCET_NOTE));
  // What did happen on chain is still reported.
  assert.equal(run.summary.chain.contractAddress, run.server.contract);
  assert.ok(
    run.summary.notes.includes(
      "The run stopped after the deploy: a contract is on chain, and no token was minted.",
    ),
  );
  assert.ok(run.stdout.includes(`Contract            ${run.server.contract}`));
});

test("without `artifacts` from scaffold_app nothing is deployed", { skip }, async (t) => {
  const run = await e2e(t, ["--source", "npm"], { stub: { noArtifacts: true } });
  assert.equal(run.status, 1);
  assert.deepEqual(toolNames(run), ["scaffold_app"]);
  assert.equal(run.summary.failure.step, "artifact");
  assert.match(run.summary.failure.reason, /scaffold_app did not report any `artifacts`/);
  // The raw output of the failing step is what the tool answered.
  assert.match(run.stdout, /\| +"filesCreated": 2/);
});

test("a wallet for another chain stops the run before anything is signed", { skip }, async (t) => {
  const run = await e2e(t, ["--source", "npm"], { stub: { walletChain: "c-chain" } });
  assert.equal(run.status, 1);
  assert.deepEqual(toolNames(run), ["scaffold_app", "wallet_status"]);
  assert.equal(run.summary.failure.step, "wallet");
  assert.match(run.summary.failure.reason, /answered for "c-chain"\. Nothing was sent\./);
});

test("a token that does not belong to the address that minted fails the run", {
  skip,
}, async (t) => {
  const run = await e2e(t, ["--source", "npm"], { stub: { wrongOwner: true } });
  assert.equal(run.status, 1);
  assert.equal(run.summary.failure.step, "verify");
  assert.equal(
    run.summary.failure.reason,
    `ownerOf(1) should be ${run.server.signer}, the address that minted.`,
  );
  assert.equal(run.summary.chain.mintTxHash, run.server.mintTx);
});

test("a deployer key that a tool echoes is not repeated anywhere", { skip }, async (t) => {
  const key = randomBytes(32).toString("hex");
  const fake = fakeRepo(t);
  const stepSummary = join(fake.repo, "step-summary.md");
  const run = await e2e(t, ["--source", "npm"], {
    fake,
    stub: { deployError: "deploy failed with key", echoKey: true },
    env: { AVAKIT_DEPLOYER_KEY: `0x${key}`, GITHUB_STEP_SUMMARY: stepSummary },
  });
  assert.equal(run.status, 1);
  const everything = [
    run.stdout,
    run.stderr,
    JSON.stringify(run.summary),
    readFileSync(stepSummary, "utf8"),
  ].join("\n");
  assert.ok(!everything.toLowerCase().includes(key));
  assert.ok(run.stdout.includes("deploy failed with key [redacted]"));
  assert.ok(run.summary.failure.reason.endsWith("deploy failed with key [redacted]"));
});

test("a failing install is reported with npm's output, and nothing is built", {
  skip,
}, async (t) => {
  const run = await e2e(t, ["--source", "npm", "--skip-chain"], { npm: { installFails: true } });
  assert.equal(run.status, 1);
  assert.equal(run.summary.failure.step, "install");
  assert.equal(run.summary.failure.reason, '"npm install" exited with code 1.');
  assert.match(run.stdout, /\| npm error code ERESOLVE/);
  assert.equal(stepStatus(run).build, "not run");
  assert.ok(!run.recorded.some((entry) => entry.who === "npm" && entry.args[0] === "run"));
});

test("from a checkout: the app is installed only when npm has the code under test", {
  skip,
}, async (t) => {
  const published = { "@avakit/core": ["0.2.0", "0.2.1"], "@avakit/react": ["0.2.1", "0.2.2"] };

  // Published pins and nothing unreleased: install and build run.
  const released = await e2e(t, ["--source", "workspace", "--skip-chain"], { npm: { published } });
  assert.equal(released.status, 0, released.stdout + released.stderr);
  assert.deepEqual(stepStatus(released), {
    environment: "passed",
    server: "passed",
    tools: "passed",
    scaffold: "passed",
    pins: "passed",
    install: "passed",
    build: "passed",
  });
  assert.equal(released.summary.server.startedWith, "node packages/mcp/dist/index.js");
  assert.ok(!released.recorded.some((entry) => entry.who === "npx"));

  // A pin that npm does not have: skipped, and said so.
  const unpublished = await e2e(t, ["--source", "workspace", "--skip-chain"], {
    npm: { published: { "@avakit/core": ["0.2.0"], "@avakit/react": ["0.2.1"] } },
  });
  assert.equal(unpublished.status, 0);
  assert.equal(stepStatus(unpublished).install, "skipped");
  assert.equal(stepStatus(unpublished).build, "skipped");
  assert.match(unpublished.stdout, /PASSED in [\d.]+s \(on-chain half not run; 2 steps skipped\)/);
  assert.match(unpublished.stdout, /@avakit\/core@\^0\.2\.1 is not on npm yet/);
  assert.ok(
    !unpublished.recorded.some((entry) => entry.who === "npm" && entry.args[0] === "install"),
  );

  // Published pins, but an unreleased change to one of them in this checkout.
  const fake = fakeRepo(t);
  mkdirSync(join(fake.repo, ".changeset"));
  writeFileSync(
    join(fake.repo, ".changeset", "next-core.md"),
    '---\n"@avakit/core": patch\n---\n\nA fix.\n',
  );
  writeFileSync(join(fake.repo, ".changeset", "other.md"), '---\n"@avakit/studio": minor\n---\n');
  const pending = await e2e(t, ["--source", "workspace", "--skip-chain"], {
    fake,
    npm: { published },
  });
  assert.equal(pending.status, 0);
  assert.equal(stepStatus(pending).install, "skipped");
  assert.match(pending.stdout, /\.changeset\/next-core\.md is not released yet/);
  assert.ok(!pending.stdout.includes("other.md"));
});

test("from a checkout that is not built, the run says what to build", { skip }, async (t) => {
  const fake = fakeRepo(t);
  rmSync(fake.server);
  const run = await e2e(t, ["--source", "workspace", "--skip-chain"], { fake });
  assert.equal(run.status, 1);
  assert.equal(run.summary.failure.step, "server");
  assert.match(run.summary.failure.reason, /packages\/mcp is not built/);
});

test("a server that answers as another version than the one asked for fails the run", {
  skip,
}, async (t) => {
  const run = await e2e(t, ["--source", "npm", "--version", "1.2.3", "--skip-chain"], {
    stub: { version: "1.2.2" },
  });
  assert.equal(run.status, 1);
  assert.equal(run.summary.failure.step, "server");
  assert.match(
    run.summary.failure.reason,
    /asked for @avakit\/mcp@1\.2\.3, but .* is version 1\.2\.2/,
  );
});

test("the time limit stops a run that hangs, and the server with it", { skip }, async (t) => {
  // The server never answers `initialize`, so the limit is the only way out.
  const started = Date.now();
  const run = await e2e(t, ["--source", "npm", "--skip-chain"], {
    stub: { hang: true },
    env: { AVAKIT_E2E_TIMEOUT_SECONDS: "2" },
  });
  assert.equal(run.status, 1);
  assert.ok(Date.now() - started < 30_000);
  assert.equal(run.summary.failure.reason, "Timed out: the whole run is limited to 2 seconds.");
  // On a machine slow enough to spend the two seconds before the server was
  // even started, the step that was cut short is the one before it.
  assert.ok(["environment", "server"].includes(run.summary.failure.step));
  // Whatever it had started is no longer running, and nothing is left behind.
  if (run.server) assert.throws(() => process.kill(run.server.pid, 0), { code: "ESRCH" });
  assert.deepEqual(run.leftovers, []);

  const invalid = await e2e(t, ["--source", "npm"], {
    env: { AVAKIT_E2E_TIMEOUT_SECONDS: "soon" },
  });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /AVAKIT_E2E_TIMEOUT_SECONDS must be a whole number of seconds/);
  assert.deepEqual(invalid.recorded, [], "nothing is started on a usage error");
});

test("in a workflow, a version that is not one is an annotation and starts nothing", {
  skip,
}, async (t) => {
  const run = await e2e(t, ["--source", "npm", "--version", "^1.0.0"], {
    env: { GITHUB_ACTIONS: "true" },
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^Error: Invalid --version "\^1\.0\.0"/);
  assert.ok(
    run.stdout.includes(
      '::error title=AvaKit end to end::Invalid --version "^1.0.0". Give a version (0.1.28) or a dist-tag (latest).',
    ),
  );
  assert.deepEqual(run.recorded, []);
  assert.deepEqual(run.leftovers, []);
});

test("an interrupted run stops its server, tidies up and exits with the signal's status", {
  skip,
}, async (t) => {
  for (const [signal, status] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    // Interrupted while it waits for a server that will never answer.
    const run = await e2e(t, ["--source", "npm", "--skip-chain"], {
      stub: { hang: true },
      interrupt: { after: /\[server\] stub-mcp running on stdio/, signal },
    });
    assert.equal(run.status, status, signal);
    assert.equal(run.summary.failure.reason, `Interrupted (${signal}).`);
    assert.throws(() => process.kill(run.server.pid, 0), { code: "ESRCH" });
    assert.deepEqual(run.leftovers, []);
  }
});

test("--keep leaves the working directory with the app in it", { skip }, async (t) => {
  const run = await e2e(t, ["--source", "npm", "--skip-chain", "--keep"]);
  assert.equal(run.status, 0);
  assert.equal(run.leftovers.length, 1);
  const kept = join(run.fake.temp, run.leftovers[0]);
  assert.ok(run.stdout.includes(`Kept: ${kept}`));
  assert.ok(existsSync(join(kept, "e2e-nft-mint", "package.json")));
});

// ── The workflow that runs it ────────────────────────────────────────────────
//
// .github/workflows/e2e-fuji.yml is read as text, not parsed: the repo has no
// YAML dependency, and the job is a flat list of steps.

/** A workflow file, with line endings normalised so a CRLF checkout reads the same. */
const workflow = (name) => readFileSync(join(workflows, name), "utf8").replace(/\r\n/g, "\n");
/** The file without its comments, which talk about the very things it must not do. */
const code = (text) =>
  text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

test("the workflow uses Node.js and npm only, holds no secret and retries nothing", () => {
  const e2e = code(workflow("e2e-fuji.yml"));

  assert.match(e2e, /^permissions:\n {2}contents: read\n/m);
  assert.doesNotMatch(e2e, /secrets\./);
  assert.doesNotMatch(e2e, /\b(?:pnpm|yarn|bun|foundry|forge)\b/i);
  // No dependency cache: a leg starts from nothing every time.
  assert.doesNotMatch(e2e, /^\s*cache:/m);
  assert.match(e2e, /^ {10}package-manager-cache: false$/m);
  // A red leg stays red: nothing lets a failure pass or runs the script again.
  assert.doesNotMatch(e2e, /continue-on-error|retry|max-attempts/i);
  assert.match(e2e, /^ {6}fail-fast: false$/m);
  // A leg whose script wrote no summary did not finish, and is not green.
  assert.match(e2e, /^ {10}path: e2e-summary\.json\n {10}if-no-files-found: error$/m);
  assert.match(e2e, /^ {2}workflow_dispatch:\n {4}inputs:\n {6}version:/m);
  assert.match(e2e, /^ {2}schedule:\n(?: *\n)* {4}- cron: /m);
});

test("the workflow pins its actions to the commits ci.yml uses", () => {
  const pins = (text) =>
    new Map(
      [...text.matchAll(/^\s*uses: ([\w./-]+)@(\S+)(?: +# *(\S+))?$/gm)].map((match) => [
        match[1],
        `${match[2]} # ${match[3]}`,
      ]),
    );
  const e2e = pins(workflow("e2e-fuji.yml"));
  const ci = pins(workflow("ci.yml"));
  assert.deepEqual([...e2e.keys()].sort(), [
    "actions/checkout",
    "actions/setup-node",
    "actions/upload-artifact",
  ]);
  for (const action of ["actions/checkout", "actions/setup-node"]) {
    assert.equal(e2e.get(action), ci.get(action), action);
  }
  // Every one of them by full commit, with the version it stands for.
  for (const [action, pin] of e2e) assert.match(pin, /^[0-9a-f]{40} # v\d+\.\d+\.\d+$/, action);
});

test("the workflow runs the chain on one leg only, and never puts an input on a command line", () => {
  const e2e = code(workflow("e2e-fuji.yml"));

  const legs = [...e2e.matchAll(/- os: (\S+)\n\s+node: (\d+)\n\s+chain: (true|false)/g)].map(
    (match) => `${match[1]} node ${match[2]} chain ${match[3]}`,
  );
  assert.deepEqual(legs, [
    "ubuntu-latest node 22 chain false",
    "ubuntu-latest node 24 chain true",
    "ubuntu-latest node 26 chain false",
    "macos-latest node 24 chain false",
    "windows-latest node 24 chain false",
  ]);

  // The two commands: the published packages, with the chain left out unless
  // this is the one leg that has it.
  const commands = [...e2e.matchAll(/^\s*(node scripts\/e2e-fuji\.mjs .*)$/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(commands, [
    'node scripts/e2e-fuji.mjs --source npm --version "$VERSION" --json e2e-summary.json',
    'node scripts/e2e-fuji.mjs --source npm --version "$VERSION" --skip-chain --json e2e-summary.json',
  ]);
  assert.match(e2e, /^ {10}VERSION: \$\{\{ inputs\.version \|\| 'latest' \}\}$/m);

  // No expression is expanded inside a script: what a person types into the
  // version box reaches the shell as the value of a variable, never as text.
  const scripts = [...e2e.matchAll(/^( +)run: \|\n((?:\1 {2}.*\n|\n)+)/gm)].map(
    (match) => match[2],
  );
  assert.equal(scripts.length, 2);
  for (const body of scripts) assert.doesNotMatch(body, /\$\{\{/);
  assert.doesNotMatch(e2e, /^\s*run: .*\$\{\{/m);
});

test("the on-chain leg cannot pass without a minted token in its summary", { skip }, async (t) => {
  const e2e = workflow("e2e-fuji.yml");
  const step = e2e.slice(e2e.indexOf("- name: Check that a token was minted"));
  assert.match(step, /^- name: Check that a token was minted\n +if: matrix\.chain\n/);
  const inline = /node -e '\n([\s\S]*?)\n +'\n/.exec(step);
  assert.ok(inline, "the step runs an inline Node.js script");

  const dir = mkdtempSync(join(tmpdir(), "avakit-e2e-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const check = (summary) =>
    new Promise((resolve) => {
      writeFileSync(join(dir, "e2e-summary.json"), JSON.stringify(summary));
      const child = spawn(process.execPath, ["-e", inline[1]], { cwd: dir, stdio: "ignore" });
      child.once("close", (status) => resolve(status));
    });

  const chain = {
    contractAddress: `0x${"ab".repeat(20)}`,
    mintTxHash: `0x${"cd".repeat(32)}`,
    ownerOfToken1: `0x${"ef".repeat(20)}`,
  };
  assert.equal(await check({ ok: true, skipChain: false, chain }), 0);
  // Left out, cut short or failed: none of them is a minted token.
  assert.equal(await check({ ok: true, skipChain: true, chain: null }), 1);
  assert.equal(
    await check({ ok: true, skipChain: false, chain: { ...chain, mintTxHash: null } }),
    1,
  );
  assert.equal(
    await check({ ok: true, skipChain: false, chain: { ...chain, ownerOfToken1: null } }),
    1,
  );
  assert.equal(await check({ ok: false, skipChain: false, chain }), 1);
  assert.equal(await check({}), 1);
});
