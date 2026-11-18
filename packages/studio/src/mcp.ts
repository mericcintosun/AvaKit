/**
 * Studio's MCP face. The same Avalanche-native actions the dashboard exposes to
 * humans are exposed here to AI agents (Claude Code / Cursor) over stdio — spin
 * up a devnet, send an ICM message, inspect an address. Run with:
 *   avakit-studio mcp
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { banner, bannerColor } from "./banner.js";
import { getAddressData } from "./dataapi.js";
import {
  type DevnetAction,
  getDevnetStatus,
  isValidL1Params,
  type L1Params,
  runDevnetActionAsync,
} from "./devnet.js";
import { deployMessengers, getIcmState, MAX_MESSAGE_BYTES, sendIcmMessage } from "./icm.js";
import { getInventory } from "./inventory.js";
import { acquireActionLock, busyMessage, type LockAttempt } from "./lock.js";
import { VERSION } from "./version.js";

function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

function text(body: string, isError = false) {
  return { content: [{ type: "text" as const, text: body }], isError };
}

/** Build the MCP server with every Studio tool registered (not yet connected). */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "avakit-studio", version: VERSION });

  // One avalanche-cli action at a time: an agent may call tools in parallel, and
  // concurrent runs against the same local network corrupt each other. The lock
  // is the file the dashboard's run manager takes too, so the rule holds across
  // both faces of Studio, with the same refusal.
  async function devnetAction(action: DevnetAction, tail: number, params?: L1Params) {
    let lock: LockAttempt;
    try {
      lock = acquireActionLock(`devnet ${action}`);
    } catch (e) {
      return text(e instanceof Error ? e.message : String(e), true);
    }
    if (!lock.acquired) return text(busyMessage(lock.holder), true);
    try {
      const { exitCode, log } = await runDevnetActionAsync(action, params);
      return text(toJson({ exitCode, tail: log.slice(-tail) }), exitCode !== 0);
    } finally {
      lock.release();
    }
  }

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
    async () => devnetAction("create-icm", 12),
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
      return devnetAction("create-l1", 12, params);
    },
  );

  server.registerTool(
    "devnet_start",
    { title: "Start network", description: "Start the local Avalanche network.", inputSchema: {} },
    async () => devnetAction("start", 8),
  );

  server.registerTool(
    "devnet_stop",
    { title: "Stop network", description: "Stop the local Avalanche network.", inputSchema: {} },
    async () => devnetAction("stop", 8),
  );

  server.registerTool(
    "icm_state",
    {
      title: "Interchain state",
      description:
        "Report the running, ICM-ready local L1s: each one's messenger address and last received cross-chain message. A null messenger means there is none to use — never deployed, gone with a wiped devnet, or from an older Studio — until icm_deploy_messengers has run.",
      inputSchema: {},
    },
    async () => text(toJson(await getIcmState())),
  );

  server.registerTool(
    "icm_deploy_messengers",
    {
      title: "Deploy ICM messengers",
      description:
        "Deploy the AvaKitMessenger contract on each running L1 that doesn't have a usable one (none yet, gone with a wiped devnet, or from an older Studio), and link the messengers so they accept each other's messages.",
      inputSchema: {},
    },
    async () => text(toJson(await deployMessengers())),
  );

  server.registerTool(
    "icm_send",
    {
      title: "Send a cross-chain message",
      description:
        "Send a string from one running L1's messenger to another's over Interchain Messaging. Returns the transaction hash and receivedBefore, the destination's delivery count just before the send: the relayer delivers within seconds, after which icm_state reports a higher messagesReceived for the destination.",
      inputSchema: {
        from: z.string().describe("Source L1 name, e.g. chain1"),
        to: z.string().describe("Destination L1 name, e.g. chain2 (must differ from `from`)"),
        message: z
          .string()
          .min(1)
          .max(MAX_MESSAGE_BYTES)
          .describe(
            `Message text: at most ${MAX_MESSAGE_BYTES} UTF-8 bytes, and it cannot start with "-"`,
          ),
      },
    },
    async ({ from, to, message }) => {
      // sendIcmMessage runs the same checks the dashboard's HTTP route gets
      // (distinct chains, byte length, no leading dash) — there is one copy.
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
        "Balances, NFTs, and recent transactions for an address on a public Avalanche chain, via the AvaCloud Data API. A section named in `errors` could not be loaded — treat it as unknown, not as empty.",
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

  return server;
}

export async function runMcp(): Promise<void> {
  const server = createMcpServer();
  // Banner to STDERR only — stdout carries the JSON-RPC protocol here.
  if (process.stderr.isTTY) {
    process.stderr.write(banner(bannerColor(process.stderr)));
  }
  await server.connect(new StdioServerTransport());
}
