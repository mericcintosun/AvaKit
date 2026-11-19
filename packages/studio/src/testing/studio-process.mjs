// Test-only: a real, separate Studio process run straight from the TypeScript
// sources, so a test can stop it with a signal the way a user (Ctrl+C) or an
// agent's client (SIGTERM) would. Never shipped (the package publishes dist/).
//
//   node studio-process.mjs dashboard <webDir>   prints {"port":…,"token":"…"}
//   node studio-process.mjs mcp                  an MCP server on stdio
//
// Node runs the sources with its built-in type stripping (process.features.
// typescript); this hook maps the sources' "./x.js" imports to "./x.ts".

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, next) {
    if (
      specifier.startsWith(".") &&
      specifier.endsWith(".js") &&
      context.parentURL?.endsWith(".ts")
    ) {
      const ts = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(ts))) return next(ts.href, context);
    }
    return next(specifier, context);
  },
});

const [mode, webDir] = process.argv.slice(2);

if (mode === "mcp") {
  const { runMcp } = await import("../mcp.ts");
  await runMcp();
} else if (mode === "dashboard") {
  const { startServer } = await import("../server.ts");
  const server = await startServer({ cwd: process.cwd(), webDir });
  const shell = await (await fetch(server.url)).text();
  const token = /window\.__AVAKIT_STUDIO__=\{"token":"([0-9a-f]+)"\}/.exec(shell)?.[1];
  process.stdout.write(`${JSON.stringify({ port: server.port, token })}\n`);
} else {
  throw new Error(`unknown mode: ${mode}`);
}
