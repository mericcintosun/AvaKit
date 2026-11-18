import { timingSafeEqual } from "node:crypto";
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

// workerd puts its constant-time comparison on SubtleCrypto; Node keeps the
// same thing in node:crypto. Same contract: two buffers of equal length.
crypto.subtle.timingSafeEqual ??= (a, b) => timingSafeEqual(a, b);

/** A Durable Object's `ctx.storage`: SQLite, and transactions over it. */
function memoryStorage() {
  const db = new DatabaseSync(":memory:");
  const sql = {
    /** How many statements have been executed — to prove a call ran none. */
    executed: 0,
    /** Set to `(query) => boolean` to make matching statements fail. */
    failOn: null,
    exec(query, ...bindings) {
      sql.executed += 1;
      if (sql.failOn?.(query)) throw new Error("simulated storage failure");
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
  return {
    sql,
    /** Everything `closure` writes is kept, or — if it throws — none of it. */
    transactionSync(closure) {
      db.exec("BEGIN");
      try {
        const result = closure();
        db.exec("COMMIT");
        return result;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

/**
 * The `COUNTERS` binding: one object behind `idFromName("global")`, reached the
 * way a stub reaches it — asynchronously, with arguments and results copied.
 */
function fakeNamespace(Counters, env) {
  const storage = memoryStorage();
  let object = null;
  const namespace = {
    sql: storage.sql,
    /** How many times each method was called through a stub. */
    calls: { record: 0, stats: 0, purge: 0 },
    idFromName: (name) => name,
    get: () => ({
      record: (...args) => namespace.call("record", args),
      stats: (...args) => namespace.call("stats", args),
      purge: (...args) => namespace.call("purge", args),
    }),
    async call(method, args) {
      namespace.calls[method] += 1;
      object ??= new Counters({ storage }, env);
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
