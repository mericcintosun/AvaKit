import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENVIRONMENT_SUMMARIES, helpText, invocation, TOOL_SUMMARIES } from "./cli.js";
import { type Connection, connect } from "./testing/connect.js";

// What the built file does with these is checked in dist.test.ts, on a process.

describe("invocation", () => {
  it("prints the version for --version and -v", () => {
    expect(invocation(["--version"])).toBe("version");
    expect(invocation(["-v"])).toBe("version");
  });

  it("prints the usage text for --help and -h", () => {
    expect(invocation(["--help"])).toBe("help");
    expect(invocation(["-h"])).toBe("help");
  });

  it("starts the server for no arguments and for any other argument", () => {
    // What every argument did before the two flags existed.
    expect(invocation([])).toBe("serve");
    expect(invocation(["--stdio"])).toBe("serve");
    expect(invocation(["version"])).toBe("serve");
    expect(invocation(["--Version"])).toBe("serve");
    expect(invocation(["-vh"])).toBe("serve");
    expect(invocation([""])).toBe("serve");
  });

  it("lets the first flag it knows decide, wherever it stands", () => {
    expect(invocation(["--stdio", "--version"])).toBe("version");
    expect(invocation(["--help", "--version"])).toBe("help");
    expect(invocation(["-v", "-h"])).toBe("version");
  });
});

describe("the usage text", () => {
  let mcp: Connection;
  beforeEach(async () => {
    mcp = await connect();
  });
  afterEach(() => mcp.close());

  const help = helpText("1.2.3");

  it("says what this is, which version, and how to add it to a client", () => {
    expect(help.split("\n")[0]).toBe("avakit-mcp 1.2.3: the AvaKit MCP server for Avalanche");
    expect(help).toContain("claude mcp add avakit -- npx -y @avakit/mcp");
    expect(help).toContain(
      '{ "mcpServers": { "avakit": { "command": "npx", "args": ["-y", "@avakit/mcp"] } } }',
    );
    expect(help).toContain("avakit-mcp --version");
    expect(help).toContain("avakit-mcp --help");
    expect(help.endsWith("\n")).toBe(true);
  });

  it("lists exactly the tools the server registers, one line each", async () => {
    // A tool added to the server and not to the text, or the other way round,
    // fails here.
    const { tools } = await mcp.client.listTools();
    expect(TOOL_SUMMARIES.map(([name]) => name).sort()).toEqual(
      tools.map((tool) => tool.name).sort(),
    );
    expect(TOOL_SUMMARIES).toHaveLength(8);
    for (const [name, summary] of TOOL_SUMMARIES) {
      const lines = help.split("\n").filter((line) => line.startsWith(`  ${name} `));
      expect(lines, name).toHaveLength(1);
      expect(lines[0]).toContain(summary);
    }
  });

  it("lists exactly the environment variables the server reads", () => {
    // Each is declared once in the source, as `export const …_ENV = "AVAKIT_…"`.
    const src = fileURLToPath(new URL(".", import.meta.url));
    const declared = readdirSync(src)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .flatMap((file) => [
        ...readFileSync(path.join(src, file), "utf8").matchAll(/_ENV = "(AVAKIT_[A-Z_]+)"/g),
      ])
      .map((match) => match[1]);
    expect(declared).toHaveLength(5);
    expect(ENVIRONMENT_SUMMARIES.map(([name]) => name).sort()).toEqual(declared.sort());
    for (const [name] of ENVIRONMENT_SUMMARIES) {
      expect(help.split("\n").filter((line) => line.startsWith(`  ${name} `))).toHaveLength(1);
    }
  });

  it("says what a mainnet transaction needs, and never suggests a key is required", () => {
    const line = (name: string) =>
      help.split("\n").find((entry) => entry.startsWith(`  ${name} `)) ?? "";
    expect(line("AVAKIT_ALLOW_MAINNET")).toContain("your own key and confirm: true");
    expect(line("AVAKIT_DEPLOYER_KEY")).toContain("session test wallet, Fuji only");
  });

  it("fits a terminal: no line is longer than 120 characters", () => {
    for (const line of help.split("\n")) expect(line.length, line).toBeLessThanOrEqual(120);
  });
});
