/**
 * @avakit/mcp — AvaKit MCP server (stdio). The bin entry: it connects the
 * server built in `server.ts` to standard input/output and nothing else.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { banner, bannerColor } from "./banner.js";
import { server } from "./server.js";

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
