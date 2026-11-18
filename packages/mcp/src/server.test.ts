import {
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
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Connection, connect } from "./testing/connect.js";

let mcp: Connection;
beforeAll(async () => {
  mcp = await connect();
});
afterAll(() => mcp.close());

const TOOLS = [
  "deploy_contract",
  "estimate_gas",
  "get_context",
  "list_templates",
  "read_chain",
  "scaffold_app",
];

describe("the tool surface", () => {
  it("exposes exactly the six documented tools", async () => {
    const { tools } = await mcp.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS);
    for (const tool of tools) {
      expect(tool.description, tool.name).toBeTruthy();
    }
  });

  it("is described by the README's tool table, with nothing missing or invented", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const documented = [...readme.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]);
    expect(documented.sort()).toEqual(TOOLS);
  });

  it("rejects arguments a tool does not declare", async () => {
    const result = await mcp.call("list_templates", { unexpected: true });
    expect(result.isError).toBe(true);
  });
});

describe("list_templates", () => {
  it("returns every template with the chains it supports", async () => {
    const result = await mcp.call("list_templates");
    expect(result.isError).toBe(false);
    const templates = result.json<{ id: string; chains: string[] }[]>();
    expect(templates.map((t) => t.id).sort()).toEqual([
      "eerc-token",
      "erc20-token",
      "icm-messenger",
      "l1-launch",
      "minimal",
      "nft-mint",
      "token-bridge",
      "token-gated-app",
    ]);
    for (const template of templates) {
      expect(template.chains, template.id).toContain("fuji");
    }
  });
});

describe("scaffold_app", () => {
  // <base>/work stands in for the server's working directory.
  let base: string;
  let cwd: string;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(tmpdir(), "avakit-mcp-scaffold-")));
    cwd = path.join(base, "work");
    mkdirSync(cwd);
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    vi.stubEnv("AVAKIT_MCP_ROOT", "");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(base, { recursive: true, force: true });
  });

  it("creates the project in the server's working directory", async () => {
    const result = await mcp.call("scaffold_app", { name: "my-app" });
    expect(result.isError).toBe(false);
    const created = result.json<{ path: string; filesCreated: number; nextSteps: string[] }>();
    expect(created.path).toBe(path.join(cwd, "my-app"));
    expect(created.filesCreated).toBeGreaterThan(5);
    expect(created.nextSteps[0]).toBe("cd my-app");
    expect(existsSync(path.join(cwd, "my-app", "package.json"))).toBe(true);
  });

  it("creates the project in a sub-directory of it when asked", async () => {
    const result = await mcp.call("scaffold_app", { name: "my-app", directory: "apps" });
    expect(result.isError).toBe(false);
    expect(existsSync(path.join(cwd, "apps", "my-app", "package.json"))).toBe(true);
  });

  it("refuses a directory outside the working directory and creates nothing", async () => {
    mkdirSync(path.join(base, "outside"));
    const attempts = [
      // The call that planted a project one level above the server, before this check.
      { name: "planted", directory: "../outside/deep/../.." },
      { name: "planted", directory: ".." },
      { name: "planted", directory: path.join(base, "outside") },
    ];
    for (const args of attempts) {
      const result = await mcp.call("scaffold_app", args);
      expect(result.isError, args.directory).toBe(true);
      expect(result.text).toContain("Refusing to scaffold into");
      expect(result.text).toContain("AVAKIT_MCP_ROOT");
    }
    expect(readdirSync(base).sort()).toEqual(["outside", "work"]);
    expect(readdirSync(path.join(base, "outside"))).toEqual([]);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("allows another root only when the server environment names it", async () => {
    mkdirSync(path.join(base, "projects"));
    vi.stubEnv("AVAKIT_MCP_ROOT", path.join(base, "projects"));
    const result = await mcp.call("scaffold_app", { name: "my-app" });
    expect(result.isError).toBe(false);
    expect(existsSync(path.join(base, "projects", "my-app", "package.json"))).toBe(true);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("refuses an unsafe project name", async () => {
    const result = await mcp.call("scaffold_app", { name: "../evil" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Invalid project name");
    expect(readdirSync(base)).toEqual(["work"]);
  });

  it("refuses a directory that already has files in it", async () => {
    mkdirSync(path.join(cwd, "taken"));
    writeFileSync(path.join(cwd, "taken", "notes.txt"), "keep me");
    const result = await mcp.call("scaffold_app", { name: "taken" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("already exists and is not empty");
    expect(readdirSync(path.join(cwd, "taken"))).toEqual(["notes.txt"]);
  });

  it("refuses a chain the template does not support, naming the ones it does", async () => {
    for (const template of ["nft-mint", "eerc-token", "icm-messenger"]) {
      const result = await mcp.call("scaffold_app", {
        name: "my-app",
        template,
        chain: "c-chain",
      });
      expect(result.isError, template).toBe(true);
      expect(result.text).toBe(
        `Template "${template}" cannot be scaffolded for chain "c-chain". It supports: fuji.`,
      );
    }
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("scaffolds the minimal template for mainnet, the one template that lists it", async () => {
    const result = await mcp.call("scaffold_app", { name: "my-app", chain: "c-chain" });
    expect(result.isError).toBe(false);
    const providers = readFileSync(path.join(cwd, "my-app", "app", "providers.tsx"), "utf8");
    expect(providers).toContain("chains={[cChain]}");
  });
});

describe("get_context", () => {
  it("returns the AvaKit context, with the requested focus appended", async () => {
    const plain = await mcp.call("get_context");
    expect(plain.isError).toBe(false);
    expect(plain.text).toContain("# AvaKit context");

    const focused = await mcp.call("get_context", { topic: "deploy" });
    expect(focused.text).toContain("(Requested focus: deploy)");
  });
});
