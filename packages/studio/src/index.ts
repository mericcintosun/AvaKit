/**
 * `avakit-studio` — launches the local Avalanche development control center and
 * opens it in the browser. A tool you run yourself, from your own terminal.
 */

import { execFile } from "node:child_process";
import { platform } from "node:os";
import { startServer } from "./server.js";

export const VERSION = "0.1.2";

function parsePort(argv: string[]): number | undefined {
  const i = argv.findIndex((a) => a === "--port" || a === "-p");
  if (i !== -1 && argv[i + 1]) {
    const n = Number(argv[i + 1]);
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  }
  return undefined;
}

/** Best-effort: open the default browser. Never throws. */
function openBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  execFile(cmd, args, () => {
    // best-effort; the URL is printed regardless
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // MCP mode: expose the same actions to an AI agent over stdio. Nothing else
  // may write to stdout in this mode — it carries the JSON-RPC protocol.
  if (argv[0] === "mcp") {
    const { runMcp } = await import("./mcp.js");
    await runMcp();
    return;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        "avakit-studio — local control center for Avalanche development",
        "",
        "Usage:  avakit-studio [--port <n>] [--no-open]",
        "        avakit-studio mcp            run as an MCP server (for AI agents)",
        "",
        "  -p, --port <n>   port to listen on (default: a free port)",
        "      --no-open    do not open the browser automatically",
        "",
      ].join("\n"),
    );
    return;
  }

  const { url } = await startServer({ port: parsePort(argv), cwd: process.cwd() });

  process.stdout.write(
    `\n  \x1b[1mAvaKit Studio\x1b[0m\n  ▸ ${url}\n\n  Press Ctrl+C to stop.\n\n`,
  );
  if (!argv.includes("--no-open")) openBrowser(url);
}

main().catch((error: unknown) => {
  process.stderr.write(`\nError: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
