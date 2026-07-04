/**
 * @avakit/mcp — AvaKit MCP server (stdio).
 *
 * Exposes Avalanche *actions* (not just docs) to AI coding agents:
 *   • scaffold_app     — create a dapp from a template (wraps create-avalanche-app)
 *   • list_templates   — available templates
 *   • read_chain       — balance / tx receipt / contract view
 *   • deploy_contract  — deploy compiled bytecode (testnet-first, mainnet needs confirm)
 *   • get_context      — AvaKit + Avalanche coding context
 *
 * See docs/09-spec-mcp.md. Guardrails: private keys only ever come from the
 * AVAKIT_DEPLOYER_KEY env var, are never logged, and mainnet deploys require
 * explicit confirmation.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type AvaChain,
  cChain,
  fuji,
  getBalance,
  getPublicClient,
  getTransactionReceipt,
  readContract,
  toViemChain,
} from "@avakit/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { listTemplates, scaffoldApp } from "create-avalanche-app/api";
import { type Abi, type Address, createWalletClient, type Hex, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { banner, bannerColor } from "./banner.js";

function chainFrom(id: string | undefined): AvaChain {
  return id === "c-chain" ? cChain : fuji;
}

function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => (typeof val === "bigint" ? val.toString() : val), 2);
}

function text(body: string, isError = false) {
  return { content: [{ type: "text" as const, text: body }], isError };
}

// Read the version from package.json at runtime (single source of truth — it
// can never drift from the published version). dist/index.js ships next to
// package.json, so `../package.json` resolves in the published tarball.
const VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

const server = new McpServer({ name: "avakit-mcp", version: VERSION });

server.registerTool(
  "list_templates",
  {
    title: "List templates",
    description: "List the Avalanche dapp templates available to scaffold_app.",
    inputSchema: z.object({}).strict(),
  },
  async () => text(toJson(listTemplates())),
);

server.registerTool(
  "scaffold_app",
  {
    title: "Scaffold an Avalanche dapp",
    description:
      "Create a new Avalanche dapp from a template (minimal, nft-mint, token-gated-app, erc20-token, icm-messenger, eerc-token, l1-launch, token-bridge). Wraps create-avalanche-app. Returns the created files and next steps.",
    inputSchema: z
      .object({
        name: z.string().describe("Project directory name, e.g. my-avax-app"),
        template: z
          .enum([
            "minimal",
            "nft-mint",
            "token-gated-app",
            "erc20-token",
            "icm-messenger",
            "eerc-token",
            "l1-launch",
            "token-bridge",
          ])
          .default("minimal"),
        chain: z.enum(["fuji", "c-chain"]).default("fuji"),
        wallet: z.enum(["web3auth", "injected"]).default("web3auth"),
        directory: z.string().optional().describe("Parent directory (default: cwd)"),
        local: z.boolean().optional().describe("Link @avakit/* via workspace (repo dev only)"),
      })
      .strict(),
  },
  async ({ name, template, chain, wallet, directory, local }) => {
    const parent = directory ? path.resolve(directory) : process.cwd();
    const targetDir = path.resolve(parent, name);
    if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
      return text(`Directory "${targetDir}" already exists and is not empty.`, true);
    }
    const { files } = await scaffoldApp({
      projectName: name,
      targetDir,
      template,
      chain,
      wallet,
      local,
    });
    const setup = listTemplates().find((t) => t.id === template)?.setup;
    const nextSteps = [
      `cd ${name}`,
      "pnpm install",
      ...(wallet === "web3auth" ? ["cp .env.example .env.local  # add Web3Auth client ID"] : []),
      ...(setup ? [`pnpm run ${setup}  # start the local Avalanche network (run once)`] : []),
      "pnpm dev",
    ];
    return text(toJson({ path: targetDir, filesCreated: files.length, files, nextSteps }));
  },
);

server.registerTool(
  "read_chain",
  {
    title: "Read Avalanche chain data",
    description:
      "Read a native AVAX balance, a transaction receipt, or a contract view/pure function over RPC.",
    inputSchema: z
      .object({
        action: z.enum(["balance", "txReceipt", "contractRead"]),
        chain: z.enum(["fuji", "c-chain"]).default("fuji"),
        address: z.string().optional().describe("Address for balance / contractRead"),
        hash: z.string().optional().describe("Tx hash for txReceipt"),
        abi: z.array(z.any()).optional().describe("Contract ABI for contractRead"),
        functionName: z.string().optional().describe("View function for contractRead"),
        args: z.array(z.any()).optional(),
      })
      .strict(),
  },
  async ({ action, chain, address, hash, abi, functionName, args }) => {
    const c = chainFrom(chain);
    try {
      if (action === "balance") {
        if (!address) return text("balance requires 'address'.", true);
        const wei = await getBalance(address as Address, c);
        return text(toJson({ address, chain: c.name, wei, avax: (Number(wei) / 1e18).toString() }));
      }
      if (action === "txReceipt") {
        if (!hash) return text("txReceipt requires 'hash'.", true);
        return text(toJson(await getTransactionReceipt(hash as Hex, c)));
      }
      if (!address || !abi || !functionName) {
        return text("contractRead requires 'address', 'abi', and 'functionName'.", true);
      }
      const result = await readContract(c, {
        address: address as Address,
        abi: abi as Abi,
        functionName: functionName as never,
        args,
      });
      return text(toJson(result));
    } catch (e) {
      return text(`read_chain failed: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  },
);

server.registerTool(
  "deploy_contract",
  {
    title: "Deploy a contract",
    description:
      "Deploy compiled bytecode to Avalanche using a deployer key from the AVAKIT_DEPLOYER_KEY env var. Fuji testnet by default; mainnet (c-chain) requires confirm:true.",
    inputSchema: z
      .object({
        abi: z.array(z.any()),
        bytecode: z.string().describe("Creation bytecode (0x-prefixed)"),
        args: z.array(z.any()).optional(),
        chain: z.enum(["fuji", "c-chain"]).default("fuji"),
        confirm: z.boolean().optional().describe("Required to deploy to mainnet"),
      })
      .strict(),
  },
  async ({ abi, bytecode, args, chain, confirm }) => {
    const c = chainFrom(chain);
    if (!c.testnet && !confirm) {
      return text(`Refusing to deploy to ${c.name} (mainnet) without confirm:true.`, true);
    }
    const key = process.env.AVAKIT_DEPLOYER_KEY;
    if (!key) {
      return text(
        "No deployer key found. Set AVAKIT_DEPLOYER_KEY to a 0x private key (use a throwaway testnet key — never a key holding real funds).",
        true,
      );
    }
    try {
      const account = privateKeyToAccount(key as Hex);
      const viemChain = toViemChain(c);
      const wallet = createWalletClient({ account, chain: viemChain, transport: http(c.rpcUrl) });
      const publicClient = getPublicClient(c);
      const bc = bytecode.startsWith("0x") ? (bytecode as Hex) : (`0x${bytecode}` as Hex);
      const txHash = await wallet.deployContract({
        abi: abi as Abi,
        bytecode: bc,
        args,
        account,
        chain: viemChain,
      } as never);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (!receipt.contractAddress) {
        return text("Deployment did not return a contract address.", true);
      }
      return text(
        toJson({
          address: receipt.contractAddress,
          txHash,
          explorerUrl: `${c.explorerUrl}/address/${receipt.contractAddress}`,
        }),
      );
    } catch (e) {
      return text(`deploy failed: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  },
);

const AVAKIT_CONTEXT = `# AvaKit context

AvaKit is an open-source, AI-native Avalanche developer toolkit.

## Scaffolding
- \`scaffold_app\` (this MCP) or \`npm create avalanche-app@latest\`
- Templates: minimal, nft-mint, token-gated-app, erc20-token, icm-messenger, eerc-token, l1-launch, token-bridge
- Each app ships shadcn/ui (black & white + dark/light), social-login wallet, and CLAUDE.md/llms.txt/.cursor rules.

## @avakit/react
- \`<AvaKitProvider chains={[...]} adapters={[...]}>\`, \`<ConnectAvalanche />\`
- Hooks: useAvaAccount, useAvaChain, useBalance, useContract, useAvaDeploy, useAvaKit

## @avakit/core
- Chains: fuji, cChain, defineChain (from @avakit/core/chains)
- Adapters: injectedAdapter(), web3authAdapter({ clientId }) (from @avakit/core/web3auth)
- getPublicClient, getWalletClient, ensureChain, deployContract, getBalance, readContract

## Conventions
- UI: shadcn/ui only. Black & white until brand colors are added; dark/light from day one.
- Chains: Fuji testnet by default; mainnet is explicit opt-in.
- Secrets: never in code. Web3Auth client ID (free) in NEXT_PUBLIC_WEB3AUTH_CLIENT_ID.

## Docs
- Avalanche Builder Hub: https://build.avax.network/llms.txt
- Web3Auth dashboard: https://dashboard.web3auth.io
- Fuji faucet: https://core.app/tools/testnet-faucet`;

server.registerTool(
  "get_context",
  {
    title: "Get AvaKit context",
    description:
      "Return AvaKit + Avalanche context for coding: the API surface, conventions, and doc links.",
    inputSchema: z
      .object({ topic: z.string().optional().describe("Optional focus topic") })
      .strict(),
  },
  async ({ topic }) =>
    text(topic ? `${AVAKIT_CONTEXT}\n\n(Requested focus: ${topic})` : AVAKIT_CONTEXT),
);

async function main(): Promise<void> {
  // Banner goes to STDERR only — stdout is the JSON-RPC channel and must stay
  // clean. Show the full art when a human runs it in a terminal; MCP clients
  // launch us with pipes (not a TTY), so they just get the one-line log.
  if (process.stderr.isTTY) {
    process.stderr.write(banner(bannerColor(process.stderr)));
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("avakit-mcp running on stdio\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`avakit-mcp fatal: ${String(error)}\n`);
  process.exit(1);
});
