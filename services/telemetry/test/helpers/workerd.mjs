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

  // Handed over as secrets, which win over a developer's own .dev.vars.
  const options = (secrets) => ({
    root: fileURLToPath(new URL("../..", import.meta.url)),
    workers: [{ configPath: "./wrangler.toml", secrets }],
  });

  const server = createTestHarness(options(bindings));
  await server.listen();
  return {
    fetch: (...args) => server.fetch(...args),
    /** Reload the Worker with different bindings. Storage is kept. */
    configure: (next) => server.update(options(next)),
    close: () => server.close(),
  };
}
