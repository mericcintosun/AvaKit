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
  devnetStillRunning,
  getDevnetStatus,
  isValidL1Params,
  type L1Params,
  l1ConfigConflict,
  runDevnetActionAsync,
} from "./devnet.js";
import { deployMessengers, getIcmState, MAX_MESSAGE_BYTES, sendIcmMessage } from "./icm.js";
import { getInventory } from "./inventory.js";
import { acquireActionLock, busyMessage, type LockAttempt } from "./lock.js";
import { installShutdown } from "./shutdown.js";
import { VERSION } from "./version.js";

function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

function text(body: string, isError = false) {
  return { content: [{ type: "text" as const, text: body }], isError };
}

/** The title of a tool that drives Avalanche CLI, or reads and changes what it set up. */
const experimental = (title: string) => `${title} (experimental)`;

/** What an agent is told about this server when it connects. */
export const MCP_INSTRUCTIONS =
  "The devnet_* and icm_* tools are experimental: they depend on Avalanche CLI (they run it, or work on the local L1s it set up), which Ava Labs has kept in maintenance mode since December 2025, and they were last proven end to end against a live network in July 2026; Studio has changed since. " +
  "The local network they start keeps running after this server stops; devnet_stop (or `avalanche network stop`) stops it. " +
  "Interchain transactions are signed with the public EWOQ devnet key, and only for L1s whose RPC is on this machine.";

/** Build the MCP server with every Studio tool registered (not yet connected). */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "avakit-studio", version: VERSION },
    { instructions: MCP_INSTRUCTIONS },
  );

  // One avalanche-cli action at a time: an agent may call tools in parallel, and
  // concurrent runs against the same local network corrupt each other. The lock
  // is the file the dashboard's run manager takes too, so the rule holds across
  // both faces of Studio, with the same refusal. The lock records each
  // avalanche-cli command too: if this server is killed outright half-way
  // through an action, the lock stays held until that command has ended.
  async function devnetAction(action: DevnetAction, tail: number, params?: L1Params) {
    let lock: LockAttempt;
    try {
      lock = acquireActionLock(`devnet ${action}`);
    } catch (e) {
      return text(e instanceof Error ? e.message : String(e), true);
    }
    if (!lock.acquired) return text(busyMessage(lock.holder), true);
    const { setCommand } = lock;
    try {
      const { exitCode, log } = await runDevnetActionAsync(action, params, setCommand);
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
      title: experimental("Devnet status"),
      description: "Report the local L1s and whether the local network is running.",
      inputSchema: {},
    },
    async () => text(toJson(await getDevnetStatus())),
  );

  server.registerTool(
    "devnet_spin_up",
    {
      title: experimental("Spin up an ICM devnet"),
      description:
        "Create two local Avalanche L1s with Interchain Messaging and a relayer, and deploy them locally. Idempotent. Takes a few minutes.",
      inputSchema: {},
    },
    async () => devnetAction("create-icm", 12),
  );

  server.registerTool(
    "devnet_launch_l1",
    {
      title: experimental("Launch your own L1"),
      description:
        "Create a single custom Subnet-EVM L1 and deploy it locally. Returns the exit code and log tail; read the chain's RPC afterwards with devnet_status. Idempotent: an existing chain with this name is reused (the log says so) when its chain id and token are the ones asked for, and the call is refused — naming the existing values — when they are not. Takes a few minutes on first run.",
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
      // An existing config with another chain ID or token is not the chain
      // that was asked for: say so instead of deploying it under that name.
      const conflict = l1ConfigConflict(params);
      if (conflict) return text(conflict, true);
      return devnetAction("create-l1", 12, params);
    },
  );

  server.registerTool(
    "devnet_start",
    {
      title: experimental("Start network"),
      description: "Start the local Avalanche network.",
      inputSchema: {},
    },
    async () => devnetAction("start", 8),
  );

  server.registerTool(
    "devnet_stop",
    {
      title: experimental("Stop network"),
      description: "Stop the local Avalanche network.",
      inputSchema: {},
    },
    async () => devnetAction("stop", 8),
  );

  server.registerTool(
    "icm_state",
    {
      title: experimental("Interchain state"),
      description:
        "Report the running, ICM-ready local L1s: each one's messenger address and last received cross-chain message. `ready` is true only when two of them have a usable messenger and those messengers are linked to each other — a message can be sent right now; `hasPeers` only says that at least two such L1s are running. A null messenger means there is none to use — never deployed, gone with a wiped devnet, or from an older Studio. While `ready` is false and `hasPeers` is true, run icm_deploy_messengers: it deploys what is missing and links the messengers.",
      inputSchema: {},
    },
    async () => text(toJson(await getIcmState())),
  );

  server.registerTool(
    "icm_deploy_messengers",
    {
      title: experimental("Deploy ICM messengers"),
      description:
        "Deploy the AvaKitMessenger contract on each running L1 that doesn't have a usable one (none yet, gone with a wiped devnet, or from an older Studio), and link the messengers so they accept each other's messages.",
      inputSchema: {},
    },
    async () => {
      // Refused (with the same busy message as every other action) while
      // another action holds Studio's action lock.
      try {
        return text(toJson(await deployMessengers()));
      } catch (e) {
        return text(e instanceof Error ? e.message : String(e), true);
      }
    },
  );

  server.registerTool(
    "icm_send",
    {
      title: experimental("Send a cross-chain message"),
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
  // Stopping stops the avalanche-cli command an agent started, as on the
  // dashboard (shutdown.ts); what Studio says about it goes to stderr. Set up
  // before anything is written, so that a client that has gone cannot crash
  // the server with a write it no longer reads (shutdown.ts).
  const shutdown = installShutdown({
    write: (text) => process.stderr.write(text),
    close: () => server.close(),
    stillRunning: () => devnetStillRunning(),
  });
  // Banner to STDERR only — stdout carries the JSON-RPC protocol here.
  if (process.stderr.isTTY) {
    process.stderr.write(banner(bannerColor(process.stderr)));
  }
  await server.connect(new StdioServerTransport());
  // An MCP client ends a stdio server by closing its stdin (SIGTERM comes only
  // if the server is still there a while later): that is a stop too. So is a
  // stdout that can no longer be written (EPIPE): nobody reads the answers any
  // more.
  const disconnected = () => void shutdown.stop("disconnected");
  process.stdin.once("end", disconnected);
  process.stdin.once("close", disconnected);
  process.stdout.on("error", disconnected);
}
