import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";

/**
 * Runs the Worker in local workerd exactly as wrangler.toml describes it —
 * real bundling, real Durable Object, real SQLite — with `bindings` (plain
 * strings, read by the Worker as `env.NAME`) on top. Nothing is deployed.
 * `config` names another configuration, relative to services/faucet, for a
 * test fixture.
 */
export async function startWorker(bindings, { config = "./wrangler.toml" } = {}) {
  // Keep the run on this machine: a test is not usage for wrangler to report,
  // and workerd does not need Cloudflare's sample `request.cf` to start.
  process.env.WRANGLER_SEND_METRICS = "false";
  process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";

  // Handed over as secrets, which win over both wrangler.toml's [vars] and a
  // developer's own .dev.vars — so a test never runs with a real key or RPC.
  const options = (secrets) => ({
    root: fileURLToPath(new URL("../..", import.meta.url)),
    workers: [{ configPath: config, secrets }],
  });

  const server = createTestHarness(options(bindings));
  await server.listen();
  return {
    fetch: (...args) => server.fetch(...args),
    /** Reload the Worker with different bindings. Storage is kept. */
    configure: (next) => server.update(options(next)),
    /** What the Worker has logged since the last `clearLogs()`. */
    logs: () => server.getLogs().map((entry) => ({ level: entry.level, text: entry.message })),
    clearLogs: () => server.clearLogs(),
    close: () => server.close(),
  };
}
