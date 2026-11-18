import { registerHooks } from "node:module";
import { memorySql } from "./sql.mjs";

/**
 * Just enough of the Workers runtime to construct the `Faucet` Durable Object
 * in plain Node, where a test can move the clock and fire its alarm by hand.
 * worker.test.mjs runs the same class for real, in workerd.
 */

// `cloudflare:workers` only exists inside workerd. All the Worker needs from it
// is the base class that hands a Durable Object its `ctx` and `env`.
const WORKERS_MODULE = `data:text/javascript,${encodeURIComponent(
  "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }",
)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") return { url: WORKERS_MODULE, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { Faucet } = await import("../../src/worker.js");

/** A Durable Object's storage: SQLite plus the single alarm an object may hold. */
function memoryStorage() {
  const storage = {
    sql: memorySql(),
    /** When the alarm is due (ms), or null. */
    alarm: null,
    getAlarm: async () => storage.alarm,
    setAlarm: async (time) => {
      storage.alarm = Number(time);
    },
  };
  return storage;
}

/** A `Faucet` object over fresh storage, and a way to fire its alarm as the runtime would. */
export function createFaucet(env) {
  const storage = memoryStorage();
  const faucet = new Faucet({ storage }, env);
  return {
    faucet,
    storage,
    async fireAlarm() {
      storage.alarm = null;
      await faucet.alarm();
    },
  };
}
