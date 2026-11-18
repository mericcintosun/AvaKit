#!/usr/bin/env bash
#
# Install @avakit/mcp the way a user's machine does and drive the installed
# server, to check the one thing the package's own tests cannot: the tarball.
#
# An MCP client gives a server a fixed time to connect (30 seconds in Claude
# Code). On an empty npm cache `npx -y @avakit/mcp` first has to download the
# server and everything it depends on, and with about 150 packages that once
# took longer than the client waits. The server is therefore published as one
# file with its third-party code inside it, and `create-avalanche-app` is its
# only dependency. This script fails when that stops being true, and reports
# what a first start costs now.
#
# What it does:
#   1. builds create-avalanche-app and @avakit/mcp if their dist is missing (an
#      existing dist is used as it is: build first if you changed the source),
#      and packs both with `pnpm pack`, which writes the real version over the
#      `workspace:*` ranges, as publishing does;
#   2. installs both tarballs with npm into a new, empty project, with an EMPTY
#      npm cache, and times it;
#   3. fails if viem, zod, @modelcontextprotocol/sdk or @avakit/core were
#      installed (they must be inside the bundle), and counts what was;
#   4. runs the installed `avakit-mcp --version`;
#   5. drives the installed server over stdio with hand-written JSON-RPC:
#      initialize, tools/list, list_templates, scaffold_app (nft-mint), and
#      checks the scaffolded files and the `artifacts` it returns;
#   6. measures the start as a client sees it: from spawning the installed
#      server to its answer to `initialize`.
#
# Network: the npm registry only, for the scaffolder's own dependencies. No
# faucet and no RPC is contacted: the one call that would read a balance runs
# with `fetch` replaced by a local stub.
#
# The install is not quite `npx -y @avakit/mcp`: the two AvaKit tarballs come
# from this repository instead of the registry, so their own download (about
# 2 MB together) is not in the time. Everything else is.
#
# Usage: scripts/smoke-mcp.sh [workdir]
#
# Without a workdir everything happens in a temporary directory that is removed
# when the script exits, pass or fail. Set SMOKE_KEEP=1 to keep it (its path is
# printed), or pass a workdir, which is never removed. A workdir must be
# outside this repository, so that nothing can resolve from its node_modules.
set -euo pipefail

# A smoke run is this repo testing itself, not someone using AvaKit, so it must
# never be counted as usage: telemetry is off for every process started here.
# (See scripts/smoke-template.sh for what happened when it was not.)
export AVAKIT_TELEMETRY_DISABLED=1

REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
CLI_DIR="$REPO/packages/create-avalanche-app"
MCP_DIR="$REPO/packages/mcp"

fail() {
  echo "✖ [mcp] $*" >&2
  exit 1
}
now_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
}

for tool in node npm pnpm; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is not on PATH"
done

# Only a directory this script created itself is ever removed.
REMOVE_WORKDIR=0
cleanup() {
  local status=$?
  [ "$REMOVE_WORKDIR" = "1" ] || return 0
  if [ "${SMOKE_KEEP:-0}" = "1" ]; then
    echo "▸ [mcp] kept $WORKDIR (SMOKE_KEEP=1)"
    return 0
  fi
  # Leave the directory before deleting it.
  cd /
  rm -rf "$WORKDIR"
  if [ "$status" -ne 0 ]; then
    echo "▸ [mcp] removed the temporary install; re-run with SMOKE_KEEP=1 to inspect it" >&2
  fi
}
trap cleanup EXIT

if [ -n "${1:-}" ]; then
  WORKDIR="$1"
  mkdir -p "$WORKDIR"
else
  WORKDIR="$(mktemp -d)"
  REMOVE_WORKDIR=1
fi
# Absolute and resolved, because the steps below change directory and the
# server reports real paths.
WORKDIR="$(cd "$WORKDIR" && pwd -P)"
case "$WORKDIR/" in
  "$REPO"/*) fail "the workdir must be outside the repository ($REPO): inside it, packages resolve from the repository's node_modules and the test proves nothing" ;;
esac

PACK_DIR="$WORKDIR/pack"
INSTALL_DIR="$WORKDIR/install"
PROJECTS_DIR="$WORKDIR/projects"
CACHE_DIR="$WORKDIR/npm-cache"
rm -rf "$PACK_DIR" "$INSTALL_DIR" "$PROJECTS_DIR" "$CACHE_DIR"
mkdir -p "$PACK_DIR" "$INSTALL_DIR" "$PROJECTS_DIR"

# ── 1. build if needed, and pack ─────────────────────────────────────────────
if [ ! -f "$CLI_DIR/dist/api.js" ] || [ ! -f "$MCP_DIR/dist/index.js" ]; then
  echo "▸ [mcp] dist is missing: building @avakit/core, create-avalanche-app and @avakit/mcp"
  ( cd "$REPO" && pnpm --filter "@avakit/core" --filter create-avalanche-app --filter "@avakit/mcp" build )
fi

echo "▸ [mcp] packing create-avalanche-app and @avakit/mcp"
( cd "$CLI_DIR" && pnpm pack --pack-destination "$PACK_DIR" >/dev/null )
( cd "$MCP_DIR" && pnpm pack --pack-destination "$PACK_DIR" >/dev/null )
CLI_TGZ="$(ls "$PACK_DIR"/create-avalanche-app-*.tgz | head -1)"
MCP_TGZ="$(ls "$PACK_DIR"/avakit-mcp-*.tgz | head -1)"
TARBALL_KB="$(( ( $(wc -c < "$MCP_TGZ") + 1023 ) / 1024 ))"

# ── 2. install both into an empty project, with an empty npm cache ───────────
cd "$INSTALL_DIR"
printf '{ "name": "avakit-mcp-smoke", "private": true }\n' > package.json
export npm_config_cache="$CACHE_DIR"
# What npx leaves out as well: none of these belongs to a first start.
export npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false

echo "▸ [mcp] npm install (empty cache) of both tarballs"
INSTALL_START="$(now_ms)"
npm install --no-progress "$CLI_TGZ" "$MCP_TGZ"
INSTALL_MS="$(( $(now_ms) - INSTALL_START ))"

# ── 3. what was installed ────────────────────────────────────────────────────
# From the lockfile npm just wrote, which lists every installed package,
# nested ones included.
cat > "$WORKDIR/inspect.cjs" <<'INSPECT'
const { readFileSync } = require("node:fs");
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const installed = Object.keys(lock.packages).filter((key) => key !== "");
const fail = (message) => {
  console.error(`✖ [mcp] ${message}`);
  process.exit(1);
};

// The bundle regressed if any of these is a package of its own again.
for (const name of ["viem", "zod", "@modelcontextprotocol/sdk", "@avakit/core"]) {
  const found = installed.filter((key) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`));
  if (found.length > 0) {
    fail(`${name} was installed (${found.join(", ")}): it must be bundled into @avakit/mcp's dist/index.js, not a dependency.`);
  }
}
// Both AvaKit packages must be the tarballs packed above, not the registry's.
for (const name of ["create-avalanche-app", "@avakit/mcp"]) {
  const entry = lock.packages[`node_modules/${name}`];
  if (!entry) fail(`${name} was not installed.`);
  if (!String(entry.resolved).startsWith("file:")) {
    fail(`${name} was installed from ${entry.resolved}, not from the tarball packed from this repository.`);
  }
}
const runtime = Object.keys(JSON.parse(readFileSync("node_modules/@avakit/mcp/package.json", "utf8")).dependencies ?? {});
if (runtime.join() !== "create-avalanche-app") {
  fail(`the packed @avakit/mcp depends on [${runtime.join(", ")}]; it must depend on create-avalanche-app only.`);
}
process.stdout.write(String(installed.length));
INSPECT
INSTALLED_PACKAGES="$(node "$WORKDIR/inspect.cjs")"
INSTALLED_KB="$(du -sk node_modules | cut -f1)"

for file in index.js THIRD_PARTY_LICENSES.txt; do
  [ -f "node_modules/@avakit/mcp/dist/$file" ] || fail "the packed @avakit/mcp has no dist/$file"
done
if ls node_modules/@avakit/mcp/dist/*.map >/dev/null 2>&1; then
  fail "the packed @avakit/mcp ships a source map, which carries the sources of the bundled libraries"
fi

# ── 4. --version, from the installed bin ─────────────────────────────────────
BIN="$INSTALL_DIR/node_modules/.bin/avakit-mcp"
[ -x "$BIN" ] || fail "the install has no executable node_modules/.bin/avakit-mcp"
EXPECTED_VERSION="$(node -p 'require(process.argv[1]).version' "$MCP_DIR/package.json")"
INSTALLED_VERSION="$("$BIN" --version)"
[ "$INSTALLED_VERSION" = "$EXPECTED_VERSION" ] ||
  fail "avakit-mcp --version printed \"$INSTALLED_VERSION\", expected \"$EXPECTED_VERSION\""
echo "▸ [mcp] avakit-mcp --version: $INSTALLED_VERSION"

# ── 5 and 6. drive the installed server over stdio, and time its start ───────
cat > "$WORKDIR/offline.mjs" <<'OFFLINE'
// Loaded into the server with NODE_OPTIONS=--import for one call below: every
// JSON-RPC request is answered with zero, here, so no RPC is contacted.
globalThis.fetch = async (_url, init) => {
  const answer = (call) => ({ jsonrpc: "2.0", id: call.id, result: "0x0" });
  const body = JSON.parse(String(init?.body ?? "{}"));
  return new Response(JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)), {
    headers: { "content-type": "application/json" },
  });
};
OFFLINE

cat > "$WORKDIR/drive.mjs" <<'DRIVER'
// Talks to the installed server the way an MCP client does: one hand-written
// JSON-RPC message per line on its stdin, one answer per line on its stdout.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [bin, projects, offline, report] = process.argv.slice(2);
const INITIALIZE = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke-mcp", version: "0.0.0" },
};

// The server's environment: the caller's, without anything that would
// configure the server or hand it a key.
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (name.startsWith("AVAKIT_") && name !== "AVAKIT_TELEMETRY_DISABLED") delete env[name];
}
delete env.NODE_OPTIONS;
delete env.NODE_PATH;

function start(extraEnv = {}) {
  const startedAt = performance.now();
  const child = spawn(bin, [], { cwd: projects, env: { ...env, ...extraEnv } });
  const waiting = new Map();
  const lines = [];
  let stderr = "";
  let buffered = "";
  let nextId = 1;
  const exited = new Promise((resolve) => {
    child.on("error", (error) => resolve(`could not start: ${error.message}`));
    child.on("close", (code, signal) => resolve(signal ?? code));
  });
  const timer = setTimeout(() => {
    console.error(`✖ [mcp] the server did not finish within 60 seconds. stderr:\n${stderr}`);
    child.kill("SIGKILL");
    process.exit(1);
  }, 60_000);
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    for (;;) {
      const end = buffered.indexOf("\n");
      if (end === -1) break;
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      lines.push(line);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // Reported below: stdout must hold protocol frames only.
      }
      waiting.get(message.id)?.(message);
    }
  });
  const request = (method, params) => {
    const id = nextId++;
    const answered = new Promise((resolve) => waiting.set(id, resolve));
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`);
    return Promise.race([
      answered,
      exited.then((how) => {
        throw new Error(`the server exited (${how}) before answering ${method}. stderr:\n${stderr}`);
      }),
    ]);
  };
  return {
    startedAt,
    request,
    notify: (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`),
    async callTool(name, args = {}) {
      const { result, error } = await request("tools/call", { name, arguments: args });
      assert.equal(error, undefined, `${name}: ${JSON.stringify(error)}`);
      return { isError: result.isError === true, text: result.content.map((part) => part.text ?? "").join("\n") };
    },
    async close() {
      child.stdin.end();
      const how = await exited;
      clearTimeout(timer);
      assert.equal(how, 0, `the server should exit with 0 when its input ends, got ${how}. stderr:\n${stderr}`);
      for (const line of lines) {
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          assert.fail(`the server wrote a line to stdout that is not a JSON-RPC message: ${line.slice(0, 200)}`);
        }
        assert.equal(frame.jsonrpc, "2.0");
      }
    },
  };
}

// The session a client has: initialize, list the tools, use them.
const mcp = start();
const initialized = await mcp.request("initialize", INITIALIZE);
const startMs = Math.round(performance.now() - mcp.startedAt);
assert.equal(initialized.result?.serverInfo?.name, "avakit-mcp");
mcp.notify("notifications/initialized");

const tools = (await mcp.request("tools/list")).result.tools.map((tool) => tool.name).sort();
assert.deepEqual(tools, [
  "deploy_contract",
  "estimate_gas",
  "get_context",
  "list_templates",
  "read_chain",
  "scaffold_app",
  "wallet_status",
  "write_contract",
]);

const listed = await mcp.callTool("list_templates");
assert.equal(listed.isError, false, listed.text);
const templates = JSON.parse(listed.text).map((template) => template.id);
assert.equal(templates.length, 8, `expected eight templates, got ${templates.join(", ")}`);
assert.ok(templates.includes("nft-mint"));

const scaffolded = await mcp.callTool("scaffold_app", { name: "smoke-nft", template: "nft-mint" });
assert.equal(scaffolded.isError, false, scaffolded.text);
const project = JSON.parse(scaffolded.text);
assert.equal(realpathSync(project.path), path.join(realpathSync(projects), "smoke-nft"));
assert.deepEqual(project.artifacts, ["smoke-nft/lib/nft-artifact.ts"]);
assert.ok(project.filesCreated > 10, `only ${project.filesCreated} files were created`);
for (const file of ["package.json", "lib/nft-artifact.ts", "app/page.tsx", "CLAUDE.md"]) {
  assert.ok(existsSync(path.join(project.path, file)), `the scaffolded project has no ${file}`);
  assert.ok(project.files.includes(file), `scaffold_app did not list ${file}`);
}

// Input validation is zod's and the SDK's, the address checksum is viem's:
// all three are inside the bundle now.
const mistyped = await mcp.callTool("write_contract", {
  address: "0x52908400098527886E0F7030069857D2E4169ee7",
  functionName: "mint",
  artifactPath: project.artifacts[0],
});
assert.equal(mistyped.isError, true);
assert.match(mistyped.text, /EIP-55 checksum/);
await mcp.close();

// A second server with fetch stubbed: making the session wallet and reading
// its balance run the bundled viem end to end (keys, addresses, the RPC
// client) without contacting an RPC.
const stubbed = start({ NODE_OPTIONS: `--import ${pathToFileURL(offline).href}` });
await stubbed.request("initialize", INITIALIZE);
stubbed.notify("notifications/initialized");
const status = await stubbed.callTool("wallet_status");
assert.equal(status.isError, false, status.text);
const wallet = JSON.parse(status.text);
assert.match(wallet.address, /^0x[0-9a-fA-F]{40}$/);
assert.equal(wallet.source, "session");
assert.equal(wallet.balanceWei, "0");
await stubbed.close();

writeFileSync(report, `START_MS=${startMs}\nTOOLS=${tools.length}\nTEMPLATES=${templates.length}\nARTIFACT=${project.artifacts[0]}\nFILES=${project.filesCreated}\n`);
DRIVER

echo "▸ [mcp] driving the installed server over stdio"
node "$WORKDIR/drive.mjs" "$BIN" "$PROJECTS_DIR" "$WORKDIR/offline.mjs" "$WORKDIR/drive.report"
report() {
  sed -n "s/^$1=//p" "$WORKDIR/drive.report"
}
START_MS="$(report START_MS)"

seconds() {
  awk -v ms="$1" 'BEGIN { printf "%.1f", ms / 1000 }'
}
megabytes() {
  awk -v kb="$1" 'BEGIN { printf "%.1f", kb / 1024 }'
}

echo ""
echo "── @avakit/mcp $INSTALLED_VERSION, installed from its tarball ──"
echo "  tarball                  $TARBALL_KB kB"
echo "  packages installed       $INSTALLED_PACKAGES (viem, zod, the MCP SDK and @avakit/core are inside dist/index.js)"
echo "  size on disk             $(megabytes "$INSTALLED_KB") MB"
echo "  install, empty cache     $(seconds "$INSTALL_MS") s"
echo "  server start             $(seconds "$START_MS") s (spawn to the answer to initialize)"
echo "  first start, in all      $(seconds "$(( INSTALL_MS + START_MS ))") s (install + start; a client waits 30 s)"
echo "  tools/list               $(report TOOLS) tools"
echo "  list_templates           $(report TEMPLATES) templates"
echo "  scaffold_app nft-mint    $(report FILES) files, artifacts: $(report ARTIFACT)"
echo "✓ [mcp] OK"
