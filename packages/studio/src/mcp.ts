/**
 * Studio's MCP face. The same Avalanche-native actions the dashboard exposes to
 * humans are exposed here to AI agents (Claude Code / Cursor) over stdio — spin
 * up a devnet, send an ICM message, inspect an address. Run with:
 *   avakit-studio mcp
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getAddressData } from "./dataapi.js";
import { getDevnetStatus, isValidL1Params, runDevnetActionAsync } from "./devnet.js";
import { deployMessengers, getIcmState, sendIcmMessage } from "./icm.js";
import { getInventory } from "./inventory.js";

function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

function text(body: string, isError = false) {
  return { content: [{ type: "text" as const, text: body }], isError };
}

export async function runMcp(): Promise<void> {
  const server = new McpServer({ name: "avakit-studio", version: "0.1.0" });

  server.registerTool(
    "avalanche_env",
    {
      title: "Avalanche environment",
      description:
        "Detect the local Avalanche toolchain (avalanche-cli, Foundry), the current project, and any local L1s.",
      inputSchema: {},
    },
    async () => text(toJson(await getInventory(process.cwd()))),
  );

  server.registerTool(
    "devnet_status",
    {
      title: "Devnet status",
      description: "Report the local L1s and whether the local network is running.",
      inputSchema: {},
    },
    async () => text(toJson(await getDevnetStatus())),
  );

  server.registerTool(
    "devnet_spin_up",
    {
      title: "Spin up an ICM devnet",
      description:
        "Create two local Avalanche L1s with Interchain Messaging and a relayer, and deploy them locally. Idempotent. Takes a few minutes.",
      inputSchema: {},
    },
    async () => {
      const { exitCode, log } = await runDevnetActionAsync("create-icm");
      return text(toJson({ exitCode, tail: log.slice(-12) }), exitCode !== 0);
    },
  );

  server.registerTool(
    "devnet_launch_l1",
    {
      title: "Launch your own L1",
      description:
        "Create a single custom Subnet-EVM L1 and deploy it locally. Returns the exit code and log tail; read the chain's RPC afterwards with devnet_status. Idempotent (won't recreate an existing chain). Takes a few minutes on first run.",
      inputSchema: {
        name: z
          .string()
          .regex(/^[a-z][a-z0-9]{1,31}$/)
          .describe("Lowercase chain name, e.g. mychain"),
        chainId: z
          .string()
          .regex(/^[1-9][0-9]{0,9}$/)
          .describe("EVM chain id, e.g. 9999 (1–4294967295)"),
        token: z
          .string()
          .regex(/^[A-Z][A-Z0-9]{0,7}$/)
          .default("MYL1")
          .describe("Native token symbol, 1–8 upper-case chars"),
      },
    },
    async ({ name, chainId, token }) => {
      const params = { name, chainId, token };
      if (!isValidL1Params(params)) return text("invalid L1 parameters", true);
      const { exitCode, log } = await runDevnetActionAsync("create-l1", params);
      return text(toJson({ exitCode, tail: log.slice(-12) }), exitCode !== 0);
    },
  );

  server.registerTool(
    "devnet_start",
    { title: "Start network", description: "Start the local Avalanche network.", inputSchema: {} },
    async () => {
      const { exitCode, log } = await runDevnetActionAsync("start");
      return text(toJson({ exitCode, tail: log.slice(-8) }), exitCode !== 0);
    },
  );

  server.registerTool(
    "devnet_stop",
    { title: "Stop network", description: "Stop the local Avalanche network.", inputSchema: {} },
    async () => {
      const { exitCode, log } = await runDevnetActionAsync("stop");
      return text(toJson({ exitCode, tail: log.slice(-8) }), exitCode !== 0);
    },
  );

  server.registerTool(
    "icm_state",
    {
      title: "Interchain state",
      description: "Report each L1's messenger address and last received cross-chain message.",
      inputSchema: {},
    },
    async () => text(toJson(await getIcmState())),
  );

  server.registerTool(
    "icm_deploy_messengers",
    {
      title: "Deploy ICM messengers",
      description: "Deploy the AvaKitMessenger contract on each running L1 that doesn't have one.",
      inputSchema: {},
    },
    async () => text(toJson(await deployMessengers())),
  );

  server.registerTool(
    "icm_send",
    {
      title: "Send a cross-chain message",
      description:
        "Send a string from one L1's messenger to the other's over Interchain Messaging.",
      inputSchema: {
        from: z.string().describe("Source L1 name, e.g. chain1"),
        to: z.string().describe("Destination L1 name, e.g. chain2"),
        message: z.string().max(200).describe("Message text"),
      },
    },
    async ({ from, to, message }) => {
      try {
        return text(toJson(await sendIcmMessage(from, to, message)));
      } catch (e) {
        return text(e instanceof Error ? e.message : String(e), true);
      }
    },
  );

  server.registerTool(
    "data_lookup",
    {
      title: "Look up address data",
      description:
        "Balances, NFTs, and recent transactions for an address on a public Avalanche chain, via the AvaCloud Data API.",
      inputSchema: {
        address: z.string().describe("0x… address"),
        chainId: z
          .enum(["43113", "43114"])
          .default("43113")
          .describe("43113 = Fuji, 43114 = C-Chain"),
      },
    },
    async ({ address, chainId }) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return text("invalid address", true);
      return text(toJson(await getAddressData(address, Number(chainId))));
    },
  );

  await server.connect(new StdioServerTransport());
}
