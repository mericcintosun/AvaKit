/**
 * The dashboard as `avakit-studio` runs it: the local server, and the way it
 * stops (shutdown.ts). On Ctrl+C it stops the avalanche-cli command it started
 * and says what keeps running, on stdout, where the person who started it
 * looks.
 */

import { devnetStillRunning } from "./devnet.js";
import { type StudioServer, startServer } from "./server.js";
import { installShutdown } from "./shutdown.js";

export async function serveDashboard(opts: {
  port?: number;
  cwd: string;
  /** Serve the UI from here instead of the bundled build (used by tests). */
  webDir?: string;
}): Promise<StudioServer> {
  const server = await startServer(opts);
  installShutdown({
    write: (text) => process.stdout.write(text),
    close: () => server.close(),
    stillRunning: () => devnetStillRunning(),
  });
  return server;
}
