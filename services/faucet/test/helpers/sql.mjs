import { DatabaseSync } from "node:sqlite";

/**
 * A Durable Object's `ctx.storage.sql`, backed by an in-memory SQLite database,
 * so the limiter's real SQL runs in plain Node with a clock the test controls.
 * Only the parts of the cursor the Worker uses are here.
 */
export function memorySql() {
  const db = new DatabaseSync(":memory:");
  return {
    db,
    exec(query, ...bindings) {
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
}
