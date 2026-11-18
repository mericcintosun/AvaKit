import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Connection, connect } from "./testing/connect.js";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const read = (file: string) => readFileSync(path.join(packageDir, file), "utf8");

interface Listing {
  name: string;
  description: string;
  version: string;
  packages: { registryType: string; identifier: string; version: string; transport: object }[];
}

const pkg = JSON.parse(read("package.json")) as { name: string; version: string; mcpName: string };
const listing = JSON.parse(read("server.json")) as Listing;

describe("server.json, the MCP Registry listing", () => {
  it("lists the same version as package.json", () => {
    // Nothing bumps server.json automatically, and it once sat two releases
    // behind — pinning registry clients to a build without that round's security
    // fixes. If this fails: pnpm --filter @avakit/mcp run sync:server-json
    expect(listing.version).toBe(pkg.version);
    expect(listing.packages.map((entry) => entry.version)).toEqual([pkg.version]);
  });

  it("names the server exactly as package.json's mcpName does", () => {
    // The registry checks this against the package published to npm.
    expect(listing.name).toBe(pkg.mcpName);
  });

  it("points at this npm package, over stdio", () => {
    expect(listing.packages).toEqual([
      {
        registryType: "npm",
        identifier: pkg.name,
        version: pkg.version,
        transport: { type: "stdio" },
      },
    ]);
  });

  it("keeps its description within the registry's 100 characters", () => {
    expect(listing.description.length).toBeLessThanOrEqual(100);
  });

  it("is stored exactly the way the sync script writes it", () => {
    // So a sync changes the version and nothing else.
    expect(read("server.json")).toBe(`${JSON.stringify(listing, null, 2)}\n`);
  });
});

describe("what the listing says the server does", () => {
  let mcp: Connection;
  beforeEach(async () => {
    mcp = await connect();
  });
  afterEach(() => mcp.close());

  /**
   * The actions a sentence claims: the first word of each item in "scaffold a
   * dapp, deploy contracts and send contract calls (for example mint), …", and
   * each example a bracket gives.
   */
  const actions = (enumeration: string) => {
    const examples = [...enumeration.matchAll(/\(for example ([^)]*)\)/g)].flatMap(
      (match) => match[1]?.split(/,|\bor\b|\band\b/) ?? [],
    );
    const items = enumeration.replace(/\([^)]*\)/g, " ").split(/,|\band\b/);
    return [...items, ...examples]
      .map((item) => item.trim().split(/\s+/)[0]?.toLowerCase() ?? "")
      .filter((word) => word !== "");
  };

  /** What a listing calls something a tool does under another name: both are write_contract. */
  const MEANS: Record<string, string> = { send: "write", mint: "write" };

  it("only advertises actions that a tool performs", async () => {
    // Both texts once promised "mint" when no tool could do it. Each action they
    // name must be the verb of a real tool (scaffold_app → scaffold), or one of
    // the words above for what write_contract does.
    const { tools } = await mcp.client.listTools();
    const verbs = tools.map((tool) => tool.name.split("_")[0]);

    const claims = {
      "server.json description": listing.description.replace(/\.$/, ""),
      "REGISTRIES.md": read("REGISTRIES.md").match(/Ours\s+acts — ([^.]+)\./)?.[1],
    };
    for (const [where, enumeration] of Object.entries(claims)) {
      // If a text was reworded and no longer parses, update this test with it.
      expect(enumeration, `${where}: no list of actions found`).toBeTruthy();
      const claimed = actions(enumeration ?? "");
      expect(claimed.length, where).toBeGreaterThanOrEqual(3);
      for (const action of claimed) {
        expect(verbs, `${where} claims "${action}"`).toContain(MEANS[action] ?? action);
      }
      // What this release added, said the way it was agreed.
      expect(enumeration, where).toMatch(
        /deploy contracts and send contract calls \(for example mint\) on\s+the Fuji testnet/,
      );
    }
    // The words for write_contract are only as good as the tool.
    expect(tools.map((tool) => tool.name)).toContain("write_contract");

    // And the reading above does catch a promise with nothing behind it.
    const empty = actions(
      "scaffold a dapp, bridge tokens (for example swap), and read chain state",
    );
    expect(empty).toEqual(["scaffold", "bridge", "read", "swap"]);
    expect(empty.filter((action) => !verbs.includes(MEANS[action] ?? action))).toEqual([
      "bridge",
      "swap",
    ]);
  });
});

describe("smithery.yaml, the Smithery listing", () => {
  const yaml = read(path.join("..", "..", "smithery.yaml"));
  // The function between `commandFunction: |-` and the next key at its level.
  const source = yaml.match(/^ {2}commandFunction: \|-\n((?: {4}.*\n)+)/m)?.[1] ?? "";
  // Through JSON, so the result is plain data from this realm.
  const start = (config: Record<string, string | boolean>): unknown =>
    JSON.parse(JSON.stringify(runInNewContext(`(${source})`)(config)));

  it("starts the published package and sets nothing unless asked", () => {
    // Nothing set is a working install: the session test wallet signs on Fuji.
    expect(start({})).toEqual({ command: "npx", args: ["-y", pkg.name], env: {} });
    expect(start({ disableTestWallet: false })).toEqual({
      command: "npx",
      args: ["-y", pkg.name],
      env: {},
    });
  });

  it("hands each option to the server under the variable the server reads", () => {
    const options = [...yaml.matchAll(/^ {6}([A-Za-z]+):$/gm)].map((match) => match[1]);
    expect(options).toEqual(["avakitDeployerKey", "projectsDirectory", "disableTestWallet"]);
    expect(
      start({
        avakitDeployerKey: "<deploy key>",
        projectsDirectory: "/home/you/code",
        disableTestWallet: true,
      }),
    ).toEqual({
      command: "npx",
      args: ["-y", pkg.name],
      env: {
        AVAKIT_DEPLOYER_KEY: "<deploy key>",
        AVAKIT_MCP_ROOT: "/home/you/code",
        AVAKIT_TEST_WALLET: "0",
      },
    });
  });

  it("says that a key is optional now, in the words the server uses", () => {
    // The key's description used to read "Only deploy_contract needs it", from
    // when nothing could be deployed without one.
    expect(yaml).not.toContain("Only deploy_contract needs it");
    expect(yaml).toContain("Leave it empty to start with no setup");
    expect(yaml).toContain("Fuji testnet only; mainnet stays refused");
  });

  it("offers no way to open the mainnet gate", () => {
    // On purpose: see the comment at the top of smithery.yaml.
    expect(source).not.toContain("AVAKIT_ALLOW_MAINNET");
  });
});

describe("scripts/sync-server-json.mjs", () => {
  // A throwaway copy of the package's three files, so the real ones are never touched.
  let dir: string;
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [path.join(dir, "scripts", "sync-server-json.mjs"), ...args], {
      encoding: "utf8",
    });
  const copy = () => JSON.parse(readFileSync(path.join(dir, "server.json"), "utf8")) as Listing;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "avakit-mcp-sync-"));
    mkdirSync(path.join(dir, "scripts"));
    copyFileSync(
      path.join(packageDir, "scripts", "sync-server-json.mjs"),
      path.join(dir, "scripts", "sync-server-json.mjs"),
    );
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: pkg.name, version: "9.8.7" }),
    );
    // The listing as it stands, i.e. behind the copy's newer package.json.
    writeFileSync(path.join(dir, "server.json"), read("server.json"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reports a stale listing with --check, and leaves it alone", () => {
    const result = run("--check");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("server.json is behind package.json (9.8.7)");
    expect(copy().version).toBe(pkg.version);
  });

  it("brings both version fields up to package.json, and nothing else", () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("server.json updated to @avakit/mcp@9.8.7");

    const expected = structuredClone(listing);
    expected.version = "9.8.7";
    for (const entry of expected.packages) entry.version = "9.8.7";
    expect(copy()).toEqual(expected);

    // Now in sync: a check passes and a second run changes nothing.
    expect(run("--check").status).toBe(0);
    const before = readFileSync(path.join(dir, "server.json"), "utf8");
    expect(run().stdout).toContain("already lists @avakit/mcp@9.8.7");
    expect(readFileSync(path.join(dir, "server.json"), "utf8")).toBe(before);
  });

  it("finds nothing to do for the listing that is checked in", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(packageDir, "scripts", "sync-server-json.mjs"), "--check"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
  });
});
