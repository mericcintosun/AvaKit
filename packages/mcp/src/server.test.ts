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
import { AVAKIT_FAUCET_URL, fuji } from "@avakit/core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArtifact } from "./artifact.js";
import { type Connection, connect } from "./testing/connect.js";
import { fakeNetwork } from "./testing/network.js";

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
  "wallet_status",
  "write_contract",
];

/** The tools that put a signature on something. */
const SIGNING_TOOLS = ["deploy_contract", "write_contract"];

describe("the tool surface", () => {
  it("exposes exactly the eight documented tools", async () => {
    const { tools } = await mcp.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS);
    for (const tool of tools) {
      expect(tool.description, tool.name).toBeTruthy();
    }
  });

  it("is described by the README's tool table, with nothing missing or invented", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    // The table under "## Tools"; the tables of arguments further down are not it.
    const section = readme.split(/^## /m).find((part) => part.startsWith("Tools\n")) ?? "";
    const documented = [...section.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]);
    expect(documented.sort()).toEqual(TOOLS);
  });

  it("rejects arguments a tool does not declare", async () => {
    for (const name of ["list_templates", "wallet_status", "deploy_contract", "write_contract"]) {
      const result = await mcp.call(name, { unexpected: true });
      expect(result.isError, name).toBe(true);
    }
  });

  it("gives every tool an object schema that says no to extra properties", async () => {
    // What an LLM API accepts as a tool definition, and what makes a mistyped
    // field fail loudly instead of being dropped.
    const { tools } = await mcp.client.listTools();
    for (const tool of tools) {
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
  });

  it("tells the model to leave the repository-only `local` option alone", async () => {
    // "Link @avakit/* via workspace" read like an ordinary choice; taken outside
    // the AvaKit monorepo it produces an app whose dependencies cannot install.
    const { tools } = await mcp.client.listTools();
    const scaffold = tools.find((tool) => tool.name === "scaffold_app");
    const options = scaffold?.inputSchema.properties as Record<string, { description?: string }>;
    expect(options.local?.description).toContain("only inside the AvaKit monorepo");
    expect(options.local?.description).toContain("Leave unset");
  });

  it("tells the model about both mainnet gates, so a refusal is not a surprise", async () => {
    // The description used to say confirm:true was the requirement, while the
    // server also demanded an environment variable the description never named.
    const { tools } = await mcp.client.listTools();
    const deploy = tools.find((tool) => tool.name === "deploy_contract");
    expect(deploy?.description).toContain("confirm:true");
    expect(deploy?.description).toContain("AVAKIT_ALLOW_MAINNET=1");
  });

  it("tells the model what signing needs: nothing on Fuji, three things on mainnet", async () => {
    // An agent that believes a key is needed stops and asks its user to create
    // one — the very step this server exists to remove.
    const { tools } = await mcp.client.listTools();
    const described = (name: string) => tools.find((tool) => tool.name === name)?.description ?? "";
    for (const name of SIGNING_TOOLS) {
      expect(described(name), name).toContain("On the Fuji testnet (the default) no key is needed");
      expect(described(name), name).toContain("session test wallet");
      expect(described(name), name).toContain(
        "Mainnet (c-chain) needs all three of: your own key in AVAKIT_DEPLOYER_KEY, " +
          "confirm:true in this call AND AVAKIT_ALLOW_MAINNET=1 in the server's environment",
      );
    }
    // Minting is write_contract's job, and the tools around it say so.
    expect(described("write_contract")).toContain("for example mint");
    expect(described("deploy_contract")).toContain("to mint — use write_contract");
    expect(described("read_chain")).toContain(
      "To change state (for example to mint) use write_contract",
    );
    expect(described("scaffold_app")).toContain(
      "`artifacts`: the paths of the project's compiled contracts, which deploy_contract and write_contract take as artifactPath",
    );
    expect(described("wallet_status")).toContain("never asks the faucet for funds");
    expect(described("get_context")).toContain("no key needed on Fuji");
  });

  it("marks which tools only read, so a client can ask before a write", async () => {
    const { tools } = await mcp.client.listTools();
    const annotations = Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]));
    for (const name of [
      "list_templates",
      "read_chain",
      "estimate_gas",
      "get_context",
      "wallet_status",
    ]) {
      expect(annotations[name], name).toEqual({ readOnlyHint: true });
    }
    for (const name of SIGNING_TOOLS) {
      expect(annotations[name], name).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      });
    }
    expect(annotations.scaffold_app).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
  });
});

describe("the documentation", () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

  it("covers every environment variable the server reads", () => {
    // AVAKIT_ALLOW_MAINNET shipped documented nowhere but the changelog. Any
    // variable the source reads (`env.AVAKIT_X`, or a name kept in a string
    // constant) now has to appear in the README too — whichever source file
    // reads it, so a new module cannot bring an undocumented one with it.
    const sources = readdirSync(new URL(".", import.meta.url)).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
    );
    expect(sources).toEqual(expect.arrayContaining(["server.ts", "guards.ts", "wallet.ts"]));
    const source = sources.map((file) => read(`./${file}`)).join("\n");
    const reads = source.matchAll(/(?:\benv\.|["'])(AVAKIT_[A-Z][A-Z_]*[A-Z])\b/g);
    const variables = [...new Set([...reads].map((match) => match[1]))].sort();
    expect(variables).toEqual([
      "AVAKIT_ALLOW_MAINNET",
      "AVAKIT_DEPLOYER_KEY",
      "AVAKIT_FAUCET_URL",
      "AVAKIT_MCP_ROOT",
      "AVAKIT_TEST_WALLET",
    ]);

    const readme = read("../README.md");
    const table = readme.slice(readme.indexOf("## Environment variables"));
    for (const variable of variables) {
      expect(readme, variable).toContain(`\`${variable}\``);
      expect(table, `${variable} in the table`).toContain(`| \`${variable}\` |`);
    }
  });

  it("says that mainnet needs the environment gate as well as confirm", () => {
    const readme = read("../README.md");
    expect(readme).toContain("`confirm: true` **and** `AVAKIT_ALLOW_MAINNET=1`");
    // The two sentences that used to present confirm as the whole requirement.
    expect(readme).not.toMatch(/requires? (an explicit )?`confirm: true`/i);
  });

  it("explains the session test wallet: what it is, its limits, and how to turn it off", () => {
    const readme = read("../README.md");
    const section = readme.slice(
      readme.indexOf("## Zero setup on Fuji"),
      readme.indexOf("## Tools"),
    );
    for (const said of [
      "Memory only",
      "Fuji only",
      "never written to disk",
      "one drip per wallet per 24 hours",
      "`AVAKIT_TEST_WALLET=0`",
      "`AVAKIT_DEPLOYER_KEY`",
      // The official faucet page, as the chain's definition in @avakit/core names it.
      fuji.faucetUrl ?? "(Fuji has no faucet page)",
      "free Builder Hub sign-in",
      // And the hosted faucet the session wallet asks, likewise.
      AVAKIT_FAUCET_URL,
    ]) {
      expect(section, said).toContain(said);
    }
    // The prompt, and the three calls it takes.
    expect(section).toContain(
      "Create an NFT app called my-first-dapp with AvaKit, deploy its contract to Fuji and mint the first NFT. Give me the explorer links.",
    );
    expect(section).toContain('scaffold_app({ name: "my-first-dapp", template: "nft-mint" })');
    expect(section).toContain(
      'deploy_contract({ artifactPath: "my-first-dapp/lib/nft-artifact.ts" })',
    );
    expect(section).toContain(
      'write_contract({ address, artifactPath: "my-first-dapp/lib/nft-artifact.ts", functionName: "mint" })',
    );
    expect(readme).toContain("claude mcp add avakit -- npx -y @avakit/mcp");
  });

  it("describes the official server as read-only, not as docs-only", () => {
    const readme = read("../README.md");
    expect(readme).not.toMatch(/docs-only/i);
    expect(readme).toContain("Avalanche's official MCP server is read-only");
    expect(readme).toContain("never signs");
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

  interface Scaffolded {
    path: string;
    filesCreated: number;
    files: string[];
    artifacts: string[];
    nextSteps: string[];
  }

  it("creates the project in the server's working directory", async () => {
    const result = await mcp.call("scaffold_app", { name: "my-app" });
    expect(result.isError).toBe(false);
    const created = result.json<Scaffolded>();
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

  it("returns the project's contract artifacts and the calls that deploy and mint them", async () => {
    // Without this an agent has to find the artifact file and copy about fifteen thousand hex
    // characters of bytecode into a tool call. Now it is told the path.
    const result = await mcp.call("scaffold_app", { name: "my-first-dapp", template: "nft-mint" });
    expect(result.isError).toBe(false);
    const created = result.json<Scaffolded>();
    expect(created.artifacts).toEqual(["my-first-dapp/lib/nft-artifact.ts"]);
    expect(created.nextSteps).toEqual([
      "cd my-first-dapp",
      "npm install",
      "npm run dev",
      "From this MCP server, with no key to set up on the Fuji testnet: " +
        'deploy_contract({ artifactPath: "my-first-dapp/lib/nft-artifact.ts" }), then call it with ' +
        'write_contract({ address, artifactPath: "my-first-dapp/lib/nft-artifact.ts", functionName: "mint" }). ' +
        "State-changing functions: approve(address approved, uint256 tokenId), mint(), " +
        "safeTransferFrom(address from, address to, uint256 tokenId), " +
        "safeTransferFrom(address from, address to, uint256 tokenId, bytes data), " +
        "setApprovalForAll(address operator, bool approved), " +
        "transferFrom(address from, address to, uint256 tokenId).",
    ]);
    // The path is the file that was written, and it is a deployable artifact.
    const [artifactPath = ""] = created.artifacts;
    const source = readFileSync(path.join(cwd, artifactPath), "utf8");
    expect(parseArtifact(source, artifactPath).bytecode).toMatch(/^0x[0-9a-f]{4000,}$/i);
  });

  it("gives artifact paths relative to wherever projects go", async () => {
    const nested = await mcp.call("scaffold_app", {
      name: "token",
      template: "erc20-token",
      directory: "apps/demo",
    });
    expect(nested.json<Scaffolded>().artifacts).toEqual(["apps/demo/token/lib/token-artifact.ts"]);
    // The first step takes the agent there from the same place, not to `token`.
    expect(nested.json<Scaffolded>().nextSteps[0]).toBe("cd apps/demo/token");

    // With AVAKIT_MCP_ROOT set, that root — which is also what artifactPath is read against.
    mkdirSync(path.join(base, "projects"));
    vi.stubEnv("AVAKIT_MCP_ROOT", path.join(base, "projects"));
    const rooted = await mcp.call("scaffold_app", { name: "gated", template: "token-gated-app" });
    expect(rooted.json<Scaffolded>().artifacts).toEqual(["gated/lib/nft-artifact.ts"]);
    expect(rooted.json<Scaffolded>().nextSteps[0]).toBe("cd gated");
    expect(existsSync(path.join(base, "projects", "gated", "lib", "nft-artifact.ts"))).toBe(true);
  });

  it("lists no artifacts, and suggests no deploy, for a template without a contract to deploy", async () => {
    for (const template of ["minimal", "eerc-token", "token-bridge"]) {
      const result = await mcp.call("scaffold_app", { name: `app-${template}`, template });
      expect(result.isError, template).toBe(false);
      const created = result.json<Scaffolded>();
      expect(created.artifacts, template).toEqual([]);
      expect(created.nextSteps.join("\n"), template).not.toContain("deploy_contract");
      expect(created.nextSteps.at(-1), template).toBe("npm run dev");
    }
  });

  it("does not point a template that runs on a local network at a Fuji deploy", async () => {
    // Its app deploys to the devnet its setup step starts. The signing tools
    // cannot reach that, and a Fuji deployment is not what the app talks to.
    const result = await mcp.call("scaffold_app", { name: "messenger", template: "icm-messenger" });
    const created = result.json<Scaffolded>();
    expect(created.artifacts).toEqual(["messenger/lib/messenger-artifact.ts"]);
    expect(created.nextSteps).toEqual([
      "cd messenger",
      "npm install",
      "npm run devnet  # start the local Avalanche network (run once)",
      "npm run dev",
      "This template's app deploys its contract from the browser, to the local network that " +
        "`npm run devnet` starts. deploy_contract and write_contract reach Fuji and the C-Chain only.",
    ]);
  });

  it("gives the next steps with npm, and with pnpm only for an app linked into the monorepo", async () => {
    // A client starts the server with npx, so npm is the one package manager
    // the machine is known to have. Someone without pnpm was told `pnpm install`.
    const plain = await mcp.call("scaffold_app", { name: "plain", template: "minimal" });
    expect(plain.json<Scaffolded>().nextSteps).toEqual(["cd plain", "npm install", "npm run dev"]);

    // workspace:* ranges only resolve with pnpm, inside the AvaKit repository.
    const linked = await mcp.call("scaffold_app", {
      name: "linked",
      template: "minimal",
      local: true,
    });
    expect(linked.json<Scaffolded>().nextSteps).toEqual([
      "cd linked",
      "pnpm install",
      "pnpm run dev",
    ]);
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

  it("refuses to plant a project anywhere when the server was started in the filesystem root", async () => {
    // Where Claude Desktop starts servers on macOS. Everything on the disk is
    // inside "/", so there the directory check used to let every path through.
    vi.spyOn(process, "cwd").mockReturnValue(path.parse(cwd).root);
    mkdirSync(path.join(base, "outside"));
    for (const args of [
      { name: "planted" },
      { name: "planted", directory: path.join(base, "outside") },
      { name: "planted", directory: cwd },
    ]) {
      const result = await mcp.call("scaffold_app", args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.text).toContain("not a project folder");
      expect(result.text).toContain("AVAKIT_MCP_ROOT");
    }
    expect(readdirSync(path.join(base, "outside"))).toEqual([]);
    expect(readdirSync(cwd)).toEqual([]);

    // Named in the server environment, a directory works from there as well.
    vi.stubEnv("AVAKIT_MCP_ROOT", cwd);
    const result = await mcp.call("scaffold_app", { name: "my-app" });
    expect(result.isError).toBe(false);
    expect(existsSync(path.join(cwd, "my-app", "package.json"))).toBe(true);
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

  it("refuses a name that is already a file", async () => {
    writeFileSync(path.join(cwd, "notes"), "keep me");
    const result = await mcp.call("scaffold_app", { name: "notes" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("already exists and is not a directory");
    expect(readFileSync(path.join(cwd, "notes"), "utf8")).toBe("keep me");
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

describe("wallet_status", () => {
  // The session test wallet's side of this tool is in session.test.ts.
  beforeEach(() => {
    vi.stubEnv("AVAKIT_TEST_WALLET", "");
    vi.stubEnv("AVAKIT_ALLOW_MAINNET", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports the wallet a key in AVAKIT_DEPLOYER_KEY gives, and its balance, on either chain", async () => {
    const net = fakeNetwork();
    const key = generatePrivateKey();
    const { address } = privateKeyToAccount(key);
    vi.stubEnv("AVAKIT_DEPLOYER_KEY", key);
    net.fuji.setBalance(address, 1_234_500_000_000_000_000n);
    net.cChain.setBalance(address, 7n);

    const onFuji = await mcp.call("wallet_status");
    expect(onFuji.isError).toBe(false);
    expect(onFuji.json()).toEqual({
      address,
      source: "env",
      chain: "fuji",
      balanceWei: "1234500000000000000",
      balanceAvax: "1.2345",
    });

    const onMainnet = await mcp.call("wallet_status", { chain: "c-chain" });
    expect(onMainnet.json()).toEqual({
      address,
      source: "env",
      chain: "c-chain",
      balanceWei: "7",
      balanceAvax: "0.000000000000000007",
      // A wallet is one of the three things a mainnet call needs.
      note: "A call on Avalanche C-Chain also needs confirm:true and AVAKIT_ALLOW_MAINNET=1 in the server environment, which is not set.",
    });
    vi.stubEnv("AVAKIT_ALLOW_MAINNET", "1");
    expect((await mcp.call("wallet_status", { chain: "c-chain" })).json()).toMatchObject({
      note: expect.stringMatching(/which is set\.$/),
    });

    // It only looked: a balance read per call, and nothing else on either chain.
    expect(net.fuji.calls.map((call) => call.method)).toEqual(["eth_getBalance"]);
    expect([...new Set(net.cChain.calls.map((call) => call.method))]).toEqual(["eth_getBalance"]);
    expect(net.faucet.requests).toEqual([]);
  });

  it("says so when the key is not one, without repeating it", async () => {
    const net = fakeNetwork();
    vi.stubEnv("AVAKIT_DEPLOYER_KEY", "0xnot-a-key-at-all");
    const result = await mcp.call("wallet_status");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("AVAKIT_DEPLOYER_KEY is not a valid private key");
    expect(result.text).not.toContain("not-a-key-at-all");
    expect(net.fuji.calls).toEqual([]);
  });

  it("still names the wallet when its balance cannot be read", async () => {
    const net = fakeNetwork();
    const key = generatePrivateKey();
    vi.stubEnv("AVAKIT_DEPLOYER_KEY", key);
    net.fuji.override("eth_getBalance", () => {
      throw { code: -32000, message: "header not found" };
    });
    const result = await mcp.call("wallet_status");
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      `The wallet on ${fuji.name} is ${privateKeyToAccount(key).address} (source: env), but its balance ` +
        // The node's own words, not the library's guess at what -32000 means.
        "could not be read: header not found",
    );
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

  it("tells an agent how deploying and minting work here, on Fuji and on mainnet", async () => {
    const { text } = await mcp.call("get_context");
    // On Fuji no key is needed …
    expect(text).toContain("Fuji testnet (the default): no key is needed.");
    expect(text).toContain("temporary session test wallet");
    // … on mainnet a key, confirm and the environment gate are all required …
    expect(text).toContain(
      'Mainnet (`chain: "c-chain"`) needs all three: your own key in `AVAKIT_DEPLOYER_KEY`, ' +
        "`confirm: true` in the call, and `AVAKIT_ALLOW_MAINNET=1` in the server's environment.",
    );
    expect(text).toContain("The session test wallet is never used on mainnet.");
    // … and minting is done with write_contract.
    expect(text).toContain(
      "Minting, like every other state-changing call, is done with `write_contract`.",
    );
    expect(text).toContain(
      '`scaffold_app` (its result lists `artifacts`) → `deploy_contract({ artifactPath })` → `write_contract({ address, artifactPath, functionName: "mint" })`',
    );
    // The faucet page is the one the chain's definition names, and it is said
    // to need a sign-in, which the session test wallet does not.
    expect(fuji.faucetUrl).toBe("https://build.avax.network/console/primary-network/faucet");
    expect(text).toContain(
      `- Fuji faucet: ${fuji.faucetUrl} (needs a free Builder Hub sign-in; the session test wallet above needs none: the server funds it from the AvaKit faucet)`,
    );
    expect(text).toContain(
      `test AVAX for the session wallet's address from ${fuji.faucetUrl} (that page needs a free Builder Hub sign-in)`,
    );
    expect(text).not.toContain("core.app/tools/testnet-faucet");
  });
});
