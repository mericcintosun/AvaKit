/**
 * The package a user installs is not `src/`: it is `dist/index.js`, one file
 * with the server's third-party code bundled into it. Every other suite runs
 * against the source, where each import resolves from this repo's
 * node_modules, so none of them can tell whether the bundle starts by itself.
 *
 * Here the package is built for real, into a temporary directory laid out like
 * an install — `dist/` beside `package.json`, and a `node_modules` holding the
 * one runtime dependency, `create-avalanche-app` — and the built file is run as
 * a process from there. Nothing else resolves from that directory, so a
 * package that was left out of the bundle fails here the way it would for a
 * user. `scripts/smoke-mcp.sh` repeats the proof with a real `npm install`.
 *
 * No network: the one call that would reach an RPC runs with `fetch` stubbed.
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { helpText } from "./cli.js";
import { cleanEnv, type ServerProcess, startServer } from "./testing/process.js";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")) as {
  name: string;
  version: string;
  dependencies: Record<string, string>;
};
const require = createRequire(import.meta.url);

/** The packages `tsup.config.ts` bundles: none of them may be needed at run time. */
const BUNDLED = ["@avakit/core", "@modelcontextprotocol/sdk", "viem", "zod"];

const INITIALIZE = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "hand-written", version: "0.0.0" },
};

let root: string;
let installed: string;
let entry: string;
let workspace: string;
let offline: string;

/** Run the built file to completion, as a person would from a shell. */
const run = (...args: string[]) =>
  spawnSync(process.execPath, [entry, ...args], {
    cwd: workspace,
    env: cleanEnv(),
    encoding: "utf8",
    // Nothing on stdin and nothing to wait for: a server would end at once too.
    input: "",
    timeout: 30_000,
  });

beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "avakit-mcp-dist-")));
  installed = path.join(root, "node_modules", pkg.name);
  entry = path.join(installed, "dist", "index.js");
  workspace = path.join(root, "workspace");
  mkdirSync(installed, { recursive: true });
  mkdirSync(workspace);

  // The real build, with the real config, into the stand-in install.
  const tsupManifest = require.resolve("tsup/package.json");
  const { bin } = JSON.parse(readFileSync(tsupManifest, "utf8")) as { bin: { tsup: string } };
  const built = spawnSync(
    process.execPath,
    [path.join(path.dirname(tsupManifest), bin.tsup), "--out-dir", path.join(installed, "dist")],
    { cwd: packageDir, encoding: "utf8" },
  );
  if (built.status !== 0) throw new Error(`tsup failed:\n${built.stdout}\n${built.stderr}`);
  copyFileSync(path.join(packageDir, "package.json"), path.join(installed, "package.json"));

  // Its only runtime dependency, where npm would put it. It is linked, so its
  // own dependencies resolve from its real location, as they do once installed.
  symlinkSync(
    realpathSync(path.join(packageDir, "node_modules", "create-avalanche-app")),
    path.join(root, "node_modules", "create-avalanche-app"),
    "junction",
  );

  // Answers every JSON-RPC request with zero, so a balance can be read with no
  // network. Loaded into the server process with --import.
  offline = path.join(root, "offline.mjs");
  writeFileSync(
    offline,
    `globalThis.fetch = async (_url, init) => {
  const answer = (call) => ({ jsonrpc: "2.0", id: call.id, result: "0x0" });
  const body = JSON.parse(String(init?.body ?? "{}"));
  return new Response(JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)), {
    headers: { "content-type": "application/json" },
  });
};
`,
  );
}, 120_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("the published shape of the package", () => {
  it("depends on create-avalanche-app and nothing else", () => {
    // Each further dependency is a download between `npx -y @avakit/mcp` and
    // the server's first answer, and a client waits 30 seconds for that.
    expect(Object.keys(pkg.dependencies)).toEqual(["create-avalanche-app"]);
  });

  it("builds to one executable file and its licence notices, with no source map", () => {
    expect(readdirSync(path.join(installed, "dist")).sort()).toEqual([
      "THIRD_PARTY_LICENSES.txt",
      "index.js",
    ]);
    const bundle = readFileSync(entry, "utf8");
    expect(bundle.startsWith("#!/usr/bin/env node\n")).toBe(true);
    // A map of the bundle would publish the sources of every bundled library.
    expect(bundle).not.toContain("sourceMappingURL");
  });

  it("names every package it bundles in THIRD_PARTY_LICENSES.txt", () => {
    const notices = readFileSync(path.join(installed, "dist", "THIRD_PARTY_LICENSES.txt"), "utf8");
    for (const name of BUNDLED) {
      expect(notices).toMatch(new RegExp(`^  ${name} \\d\\S* \\(`, "m"));
      expect(notices).toMatch(new RegExp(`^${name} \\d\\S*\nLicense: `, "m"));
    }
    expect(notices).toContain("Permission is hereby granted, free of charge");
  });

  it("is installed where nothing it bundles can be resolved", () => {
    // The premise of the tests below: if one of these resolved from here, a
    // missing piece of the bundle would be papered over. Asked of a process of
    // its own, started the way the server is, from a file beside the bundle.
    const probe = path.join(installed, "dist-probe.mjs");
    writeFileSync(
      probe,
      `const resolved = {};
for (const name of JSON.parse(process.argv[2])) {
  try {
    resolved[name] = import.meta.resolve(name);
  } catch {
    resolved[name] = null;
  }
}
process.stdout.write(JSON.stringify(resolved));
`,
    );
    const asked = spawnSync(
      process.execPath,
      [probe, JSON.stringify([...BUNDLED, "create-avalanche-app/api"])],
      { cwd: workspace, env: cleanEnv(), encoding: "utf8" },
    );
    expect(asked.status, asked.stderr).toBe(0);
    const resolved = JSON.parse(asked.stdout) as Record<string, string | null>;
    for (const name of BUNDLED) expect(resolved[name], name).toBeNull();
    expect(resolved["create-avalanche-app/api"]).toMatch(/create-avalanche-app\/dist\/api\.js$/);
  });
});

describe("the built server, started where only create-avalanche-app resolves", () => {
  let server: ServerProcess | undefined;
  const start = (options: { args?: string[]; nodeArgs?: string[] } = {}) => {
    server = startServer(entry, { cwd: workspace, ...options });
    return server;
  };
  afterAll(async () => {
    await server?.close();
  });

  it("answers initialize, tools/list and list_templates", async () => {
    const mcp = start();
    const initialized = await mcp.request("initialize", INITIALIZE);
    expect(initialized.result).toMatchObject({
      serverInfo: { name: "avakit-mcp", version: pkg.version },
      capabilities: { tools: {} },
    });
    mcp.notify("notifications/initialized");

    const listed = await mcp.request("tools/list");
    const tools = listed.result?.tools as { name: string; inputSchema: { type: string } }[];
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "deploy_contract",
      "estimate_gas",
      "get_context",
      "list_templates",
      "read_chain",
      "scaffold_app",
      "wallet_status",
      "write_contract",
    ]);
    // zod and the SDK's schema conversion both made it into the bundle.
    for (const tool of tools) expect(tool.inputSchema.type).toBe("object");

    const templates = await mcp.callTool("list_templates");
    expect(templates.isError).toBe(false);
    const ids = (JSON.parse(templates.text) as { id: string }[]).map((template) => template.id);
    expect(ids).toHaveLength(8);
    expect(ids).toContain("nft-mint");

    // Input validation is the SDK's and zod's, and the checksum is viem's.
    const refused = await mcp.callTool("write_contract", {
      address: "0x52908400098527886E0F7030069857D2E4169ee7",
      functionName: "mint",
      abi: ["function mint()"],
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("EIP-55 checksum");

    // Four requests, four frames, and nothing else on stdout.
    expect(mcp.lines).toHaveLength(4);
    for (const line of mcp.lines) expect(JSON.parse(line)).toMatchObject({ jsonrpc: "2.0" });
    expect(await mcp.close()).toBe(0);
    expect(mcp.stderr()).toBe("avakit-mcp running on stdio\n");
  }, 60_000);

  it("creates the session wallet and reads its balance with the bundled viem", async () => {
    // Key generation, address derivation and the RPC client are all bundled
    // code, some of it behind a dynamic import. `fetch` is stubbed in the
    // server process, so no RPC is contacted.
    const mcp = start({ nodeArgs: ["--import", offline] });
    await mcp.request("initialize", INITIALIZE);
    mcp.notify("notifications/initialized");
    const status = await mcp.callTool("wallet_status");
    expect(status.isError, status.text).toBe(false);
    expect(JSON.parse(status.text)).toMatchObject({
      address: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
      source: "session",
      chain: "fuji",
      balanceWei: "0",
      balanceAvax: "0",
    });
    expect(await mcp.close()).toBe(0);
  }, 60_000);

  it("starts the server for an argument it does not know", async () => {
    const mcp = start({ args: ["--stdio"] });
    const initialized = await mcp.request("initialize", INITIALIZE);
    expect(initialized.result).toMatchObject({ serverInfo: { name: "avakit-mcp" } });
    expect(await mcp.close()).toBe(0);
  }, 60_000);
});

describe("avakit-mcp --version and --help, on the built file", () => {
  it.each(["--version", "-v"])("%s prints the package version and exits 0", (flag) => {
    const result = run(flag);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${pkg.version}\n`);
    // The server never started: not even its one line on stderr.
    expect(result.stderr).toBe("");
  });

  it.each(["--help", "-h"])("%s prints the usage text and exits 0", (flag) => {
    const result = run(flag);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(helpText(pkg.version));
    expect(result.stderr).toBe("");
  });

  it("answers before any server exists, even with a client's request waiting on stdin", () => {
    const result = spawnSync(process.execPath, [entry, "--version"], {
      cwd: workspace,
      env: cleanEnv(),
      encoding: "utf8",
      input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: INITIALIZE })}\n`,
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${pkg.version}\n`);
  });
});
