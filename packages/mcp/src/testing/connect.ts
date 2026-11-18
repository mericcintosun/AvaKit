/**
 * Test helper: connect a real MCP client to the server over an in-memory
 * transport, so a test calls a tool exactly the way an agent would — through
 * the protocol, the input schema and the handler — without spawning a process.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "../server.js";

export interface ToolResult {
  /** Whether the tool reported a failure (`isError`). */
  isError: boolean;
  /** The text the tool returned. */
  text: string;
  /** The text parsed as JSON; throws if the tool did not return JSON. */
  json<T = Record<string, unknown>>(): T;
}

export interface Connection {
  client: Client;
  call(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}

export async function connect(): Promise<Connection> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "avakit-mcp-tests", version: "0.0.0" });
  await client.connect(clientSide);
  return {
    client,
    call: async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      const parts = result.content as { type: string; text?: string }[];
      const text = parts.map((part) => part.text ?? "").join("\n");
      return { isError: result.isError === true, text, json: () => JSON.parse(text) };
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
