import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

describe("get_context", () => {
  it("returns the AvaKit context, with the requested focus appended", async () => {
    const plain = await mcp.call("get_context");
    expect(plain.isError).toBe(false);
    expect(plain.text).toContain("# AvaKit context");

    const focused = await mcp.call("get_context", { topic: "deploy" });
    expect(focused.text).toContain("(Requested focus: deploy)");
  });
});
