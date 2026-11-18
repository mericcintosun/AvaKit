import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";

/**
 * Just enough of the Workers runtime to load src/worker.js in plain Node, where
 * a test can move the clock and look inside the Durable Object's storage. The
 * real runtime is exercised separately, in workerd.test.mjs.
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

/** A Durable Object's `ctx.storage.sql` over an in-memory SQLite database. */
function memorySql() {
  const db = new DatabaseSync(":memory:");
  const sql = {
    /** How many statements have been executed — to prove a call ran none. */
    executed: 0,
    exec(query, ...bindings) {
      sql.executed += 1;
      const rows = db.prepare(query).all(...bindings);
      return {
        toArray: () => rows,
        one() {
          if (rows.length !== 1) {
            throw new Error(`Expected exactly one result from SQL query, but got ${rows.length}`);
          }
          return rows[0];
        },
        [Symbol.iterator]: () => rows[Symbol.iterator](),
      };
    },
  };
  return sql;
}

/**
 * The `COUNTERS` binding: one object behind `idFromName("global")`, reached the
 * way a stub reaches it — asynchronously, with arguments and results copied.
 */
function fakeNamespace(Counters, env) {
  const sql = memorySql();
  let object = null;
  const namespace = {
    sql,
    /** How many times each method was called through a stub. */
    calls: { record: 0, stats: 0 },
    idFromName: (name) => name,
    get: () => ({
      record: (...args) => namespace.call("record", args),
      stats: (...args) => namespace.call("stats", args),
    }),
    async call(method, args) {
      namespace.calls[method] += 1;
      object ??= new Counters({ storage: { sql } }, env);
      return structuredClone(object[method](...structuredClone(args)));
    },
    /** Evict the object: the next call builds a new instance over the same storage. */
    evict() {
      object = null;
    },
  };
  return namespace;
}

let loads = 0;

/**
 * A fresh isolate: its own copy of the Worker module (and so of anything the
 * module keeps in memory). Pass `env` to give it an existing Durable Object,
 * the way two isolates in different places share one.
 */
export async function loadWorker({ env } = {}) {
  loads += 1;
  const module = await import(`../../src/worker.js?isolate=${loads}`);
  const bindings = env ?? { TELEMETRY_SALT: "test-salt" };
  bindings.COUNTERS ??= fakeNamespace(module.Counters, bindings);
  return {
    env: bindings,
    counters: bindings.COUNTERS,
    fetch: (path, init) =>
      module.default.fetch(new Request(`https://collector.test${path}`, init), bindings),
  };
}
