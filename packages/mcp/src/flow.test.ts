/**
 * The prompt in the README, end to end:
 *
 *   "Create an NFT app called my-first-dapp with AvaKit, deploy its contract to
 *    Fuji and mint the first NFT. Give me the explorer links."
 *
 * The test plays the agent, and is held to what the README promises of one: it
 * makes three tool calls, and every argument it passes comes from the prompt or
 * from an earlier result. It never opens a file of the project, and no key is
 * configured anywhere.
 *
 * The scaffolder and the templates are the real ones; the chain and the faucet
 * are the fake network.
 */

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fuji } from "@avakit/core";
import { templatesDir } from "create-avalanche-app/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArtifact } from "./artifact.js";
import type { Connection } from "./testing/connect.js";
import type { FakeNetwork } from "./testing/network.js";

/** What the template really ships, read here only to check what reached the chain. */
function shipped(template: string, file: string) {
  const source = readFileSync(path.join(templatesDir, template, "lib", file), "utf8");
  return parseArtifact(source, file);
}

interface Scaffolded {
  artifacts: string[];
  nextSteps: string[];
}
interface Deployed {
  address: string;
  txHash: string;
  explorerUrl: string;
  signer: { address: string; source: string };
  note?: string;
}
interface Written {
  txHash: string;
  status: string;
  explorerUrl: string;
  signer: { address: string; source: string };
}

let base: string;
let cwd: string;
let mcp: Connection;
let net: FakeNetwork;

beforeEach(async () => {
  // A fresh server per test: a fresh session wallet, with nothing behind it.
  vi.resetModules();
  const network = await import("./testing/network.js");
  net = network.fakeNetwork();
  network.fakeClock();
  // What deploying the NFT contract really takes (services/faucet/wrangler.toml).
  net.fuji.gasEstimate = 1_714_358n;

  base = realpathSync(mkdtempSync(path.join(tmpdir(), "avakit-mcp-flow-")));
  cwd = path.join(base, "workspace");
  mkdirSync(cwd);
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  for (const variable of [
    "AVAKIT_DEPLOYER_KEY",
    "AVAKIT_TEST_WALLET",
    "AVAKIT_ALLOW_MAINNET",
    "AVAKIT_FAUCET_URL",
    "AVAKIT_MCP_ROOT",
  ]) {
    vi.stubEnv(variable, "");
  }
  mcp = await (await import("./testing/connect.js")).connect();
});
afterEach(async () => {
  await mcp.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
});

describe("the README's prompt", () => {
  it("is three tool calls from an empty folder to a minted NFT, with no key and no file read", async () => {
    // 1. "Create an NFT app called my-first-dapp"
    const scaffolded = await mcp.call("scaffold_app", {
      name: "my-first-dapp",
      template: "nft-mint",
    });
    expect(scaffolded.isError).toBe(false);
    const [artifactPath] = scaffolded.json<Scaffolded>().artifacts;
    expect(artifactPath).toBe("my-first-dapp/lib/nft-artifact.ts");

    // 2. "deploy its contract to Fuji" — the path is all it takes.
    const deployed = await mcp.call("deploy_contract", { artifactPath });
    expect(deployed.isError).toBe(false);
    const contract = deployed.json<Deployed>();

    // 3. "and mint the first NFT"
    const minted = await mcp.call("write_contract", {
      address: contract.address,
      artifactPath,
      functionName: "mint",
    });
    expect(minted.isError).toBe(false);
    const mint = minted.json<Written>();

    // "Give me the explorer links": the contract's, and the mint's.
    expect(contract.explorerUrl).toBe(`${fuji.explorerUrl}/address/${contract.address}`);
    expect(mint.explorerUrl).toBe(`${fuji.explorerUrl}/tx/${mint.txHash}`);
    expect(mint.status).toBe("success");

    // What reached the chain is the template's contract, whole: 15,422 hex
    // characters that no agent had to copy.
    const [creation, call] = net.fuji.sent;
    expect(net.fuji.sent).toHaveLength(2);
    expect(creation?.data).toBe(shipped("nft-mint", "nft-artifact.ts").bytecode);
    expect(creation?.data).toHaveLength(15_422);
    expect(creation?.to).toBeNull();
    expect(creation?.created).toBe(contract.address);
    expect(call).toMatchObject({ to: contract.address, data: "0x1249c58b" });

    // Signed by the session wallet, for Fuji, with no value; funded once.
    for (const transaction of [creation, call]) {
      expect(transaction).toMatchObject({
        from: contract.signer.address,
        chainId: 43113,
        value: 0n,
      });
    }
    expect(contract.signer.source).toBe("session");
    expect(mint.signer).toEqual(contract.signer);
    expect(contract.note).toContain("temporary Fuji test wallet");
    expect(net.faucet.requests).toEqual([{ address: contract.signer.address, chainId: 43113 }]);

    // Nothing but Fuji and the faucet was contacted.
    expect(net.cChain.calls).toEqual([]);
    expect(net.strays).toEqual([]);
  });

  it("is spelled out in scaffold_app's next steps, so the agent need not work it out", async () => {
    const scaffolded = await mcp.call("scaffold_app", {
      name: "my-first-dapp",
      template: "nft-mint",
    });
    const hint = scaffolded.json<Scaffolded>().nextSteps.at(-1) ?? "";
    // The two calls, as written in the hint, are the two calls that work.
    const [, deployPath] = /deploy_contract\(\{ artifactPath: "([^"]+)" \}\)/.exec(hint) ?? [];
    const [, writePath, functionName] =
      /write_contract\(\{ address, artifactPath: "([^"]+)", functionName: "([^"]+)" \}\)/.exec(
        hint,
      ) ?? [];
    expect(deployPath).toBe("my-first-dapp/lib/nft-artifact.ts");
    const deployed = await mcp.call("deploy_contract", { artifactPath: deployPath });
    const written = await mcp.call("write_contract", {
      address: deployed.json<Deployed>().address,
      artifactPath: writePath,
      functionName,
    });
    expect(written.isError).toBe(false);
    expect(written.json<Written>().status).toBe("success");
  });

  it("works for every template whose contract goes on Fuji", async () => {
    const templates = [
      ["nft-mint", "nft-artifact.ts"],
      ["token-gated-app", "nft-artifact.ts"],
      ["erc20-token", "token-artifact.ts"],
    ] as const;
    for (const [template, file] of templates) {
      const before = net.fuji.sent.length;
      const scaffolded = await mcp.call("scaffold_app", { name: `app-${template}`, template });
      const [artifactPath] = scaffolded.json<Scaffolded>().artifacts;
      const deployed = await mcp.call("deploy_contract", { artifactPath });
      expect(deployed.isError, template).toBe(false);
      const written = await mcp.call("write_contract", {
        address: deployed.json<Deployed>().address,
        artifactPath,
        functionName: "mint",
      });
      expect(written.isError, template).toBe(false);
      expect(net.fuji.sent[before]?.data, template).toBe(shipped(template, file).bytecode);
      expect(net.fuji.sent[before + 1]?.data, template).toBe("0x1249c58b");
    }
    // One wallet did all of it, on one drip.
    expect(new Set(net.fuji.sent.map((sent) => sent.from)).size).toBe(1);
    expect(net.faucet.requests).toHaveLength(1);
  });

  it("works when the projects directory is named by AVAKIT_MCP_ROOT, as for Claude Desktop", async () => {
    // Started in the filesystem root, with the projects folder in the environment.
    const projects = path.join(base, "projects");
    mkdirSync(projects);
    vi.spyOn(process, "cwd").mockReturnValue(path.parse(cwd).root);
    vi.stubEnv("AVAKIT_MCP_ROOT", projects);

    const scaffolded = await mcp.call("scaffold_app", {
      name: "my-first-dapp",
      template: "nft-mint",
    });
    expect(scaffolded.isError).toBe(false);
    const [artifactPath] = scaffolded.json<Scaffolded>().artifacts;
    // Relative to that root — and read against it, so the path round-trips.
    expect(artifactPath).toBe("my-first-dapp/lib/nft-artifact.ts");
    const deployed = await mcp.call("deploy_contract", { artifactPath });
    expect(deployed.isError).toBe(false);
    const written = await mcp.call("write_contract", {
      address: deployed.json<Deployed>().address,
      artifactPath,
      functionName: "mint",
    });
    expect(written.isError).toBe(false);
    expect(net.fuji.sent).toHaveLength(2);
  });
});
