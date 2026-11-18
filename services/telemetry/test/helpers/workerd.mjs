import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";

/**
 * Runs the Worker in local workerd exactly as wrangler.toml describes it —
 * real bundling, real Durable Object, real SQLite — with `bindings` (plain
 * strings, read by the Worker as `env.NAME`) on top. Nothing is deployed.
 */
export async function startWorker(bindings) {
  // Keep the run on this machine: a test is not usage for wrangler to report,
  // and workerd does not need Cloudflare's sample `request.cf` to start.
  process.env.WRANGLER_SEND_METRICS = "false";
  process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";

  const server = createTestHarness({
    root: fileURLToPath(new URL("../..", import.meta.url)),
    // Handed over as secrets, which win over a developer's own .dev.vars.
    workers: [{ configPath: "./wrangler.toml", secrets: bindings }],
  });
  await server.listen();
  return {
    fetch: (...args) => server.fetch(...args),
    close: () => server.close(),
  };
}
