/**
 * `avakit-studio` — launches the local Avalanche development control center and
 * opens it in the browser. A tool you run yourself, from your own terminal.
 */

import { execFile } from "node:child_process";
import { platform } from "node:os";
import { banner, bannerColor } from "./banner.js";
import { startServer } from "./server.js";
import { VERSION } from "./version.js";

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

/** A small crimson-bordered panel (raw ANSI — matches the banner, no deps). */
function panel(lines: string[], color: boolean): string {
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const visible = (s: string) => s.replace(ansi, "").length;
  const cr = color ? "\x1b[38;2;225;29;72m" : "";
  const rs = color ? "\x1b[0m" : "";
  const width = Math.max(...lines.map(visible)) + 2;
  const bar = "─".repeat(width);
  const rows = lines.map((l) => `${cr}│${rs} ${l}${" ".repeat(width - visible(l) - 1)}${cr}│${rs}`);
  return [`${cr}╭${bar}╮${rs}`, ...rows, `${cr}╰${bar}╯${rs}`].join("\n");
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

  const color = bannerColor(process.stdout);
  const boldUrl = color ? `\x1b[1m\x1b[97m${url}\x1b[0m` : url;
  process.stdout.write(banner(color));
  process.stdout.write(
    `${panel(["AvaKit Studio — local control center", `▸ ${boldUrl}`, "Press Ctrl+C to stop."], color)}\n\n`,
  );
  if (!argv.includes("--no-open")) openBrowser(url);
}

main().catch((error: unknown) => {
  process.stderr.write(`\nError: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
