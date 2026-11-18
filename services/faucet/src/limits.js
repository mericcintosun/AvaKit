/** One drip per address in any 24 hours. */
export const ADDRESS_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The per-IP window: at most IP_MAX drips in any rolling hour. */
export const IP_WINDOW_MS = 60 * 60 * 1000;

// A whole hackathon room shares one NAT'd IP, and that room is exactly the
// audience this faucet exists for — so this is deliberately generous. It is the
// real drain defense though (the per-address limit is trivially bypassed by
// generating addresses), so it caps a single client at IP_MAX * drip per hour.
export const IP_MAX = 20;

/**
 * The faucet's rate limits, kept in the Durable Object's SQLite database.
 *
 * Every method is synchronous. A Durable Object runs one piece of JavaScript at
 * a time and only lets another request in at an `await`, so a check and the
 * insert that follows it can never be split by a concurrent request — the
 * guarantee the old KV counters (read, await, write) could not give.
 *
 * A drip is recorded when its send is about to start:
 *
 *   reserve() → it exists and already counts against both limits
 *   settle()  → the transaction went out; it keeps counting for its windows
 *   release() → the send failed; it is deleted and both allowances come back
 *
 * Every drip keeps its own timestamp, so the per-IP limit is a true rolling
 * window: a hit stops counting exactly IP_WINDOW_MS after it was made, whatever
 * the client did in between.
 *
 * @param sql the Durable Object's `ctx.storage.sql`
 */
export class DripLimits {
  #sql;

  constructor(sql) {
    this.#sql = sql;

    // One row per drip, kept for the address window.
    sql.exec(`
      CREATE TABLE IF NOT EXISTS drips (
        id INTEGER PRIMARY KEY,
        address TEXT NOT NULL,
        at INTEGER NOT NULL,
        settled INTEGER NOT NULL DEFAULT 0
      )
    `);
    sql.exec("CREATE INDEX IF NOT EXISTS drips_address ON drips (address, at)");
    sql.exec("CREATE INDEX IF NOT EXISTS drips_at ON drips (at)");
    sql.exec("CREATE INDEX IF NOT EXISTS drips_unsettled ON drips (settled) WHERE settled = 0");

    // The same drip against the client that asked for it. A separate table so
    // the client key (an IP address or an IPv6 /64) can be deleted as soon as
    // the per-IP window has passed, a day before the drip row itself.
    sql.exec(`
      CREATE TABLE IF NOT EXISTS hits (
        drip INTEGER PRIMARY KEY,
        client TEXT NOT NULL,
        at INTEGER NOT NULL
      )
    `);
    sql.exec("CREATE INDEX IF NOT EXISTS hits_client ON hits (client, at)");
    sql.exec("CREATE INDEX IF NOT EXISTS hits_at ON hits (at)");

    // This runs once per instance of the object, before it serves anything. A
    // drip still unsettled here belongs to a send that died with the previous
    // instance, so nobody is left to settle or release it: give the allowances
    // back rather than block an address that may never have been funded.
    sql.exec("DELETE FROM hits WHERE drip IN (SELECT id FROM drips WHERE settled = 0)");
    sql.exec("DELETE FROM drips WHERE settled = 0");
  }

  /**
   * Why a drip to `address` from `client` would be refused right now, or null
   * if it would be allowed. Reads only.
   *
   * @returns {{ code: "address_limited" | "ip_limited", retryAfter: number } | null}
   *   `retryAfter` is in seconds.
   */
  refusal({ address, client }, now = Date.now()) {
    const funded = this.#sql
      .exec(
        "SELECT MAX(at) AS at FROM drips WHERE address = ? AND at > ?",
        address,
        now - ADDRESS_WINDOW_MS,
      )
      .one();
    if (funded.at !== null) {
      return {
        code: "address_limited",
        retryAfter: seconds(funded.at + ADDRESS_WINDOW_MS - now),
      };
    }

    const hits = this.#sql
      .exec(
        "SELECT COUNT(*) AS n, MIN(at) AS oldest FROM hits WHERE client = ? AND at > ?",
        client,
        now - IP_WINDOW_MS,
      )
      .one();
    if (hits.n >= IP_MAX) {
      // The oldest hit in the window is the next one to stop counting.
      return { code: "ip_limited", retryAfter: seconds(hits.oldest + IP_WINDOW_MS - now) };
    }

    return null;
  }

  /**
   * Check both limits again and, if they hold, take a slot — atomically.
   *
   * @returns {{ id: number } | { refused: NonNullable<ReturnType<DripLimits["refusal"]>> }}
   */
  reserve({ address, client }, now = Date.now()) {
    // Only the write path prunes, so a flood of refused requests costs reads alone.
    this.#expire(now);

    const refused = this.refusal({ address, client }, now);
    if (refused) return { refused };

    const { id } = this.#sql
      .exec("INSERT INTO drips (address, at) VALUES (?, ?) RETURNING id", address, now)
      .one();
    this.#sql.exec("INSERT INTO hits (drip, client, at) VALUES (?, ?, ?)", id, client, now);
    return { id };
  }

  /**
   * Delete everything that has left its window, and say when the next row
   * will: a time in ms, or null once nothing is stored.
   *
   * reserve() already clears out old rows, but only when another drip comes
   * along. The Durable Object's alarm calls this so a client's address is
   * gone an hour after its drip even if that drip was the last of the day.
   */
  prune(now = Date.now()) {
    this.#expire(now);

    const expiries = [];
    const hit = this.#sql.exec("SELECT MIN(at) AS at FROM hits").one().at;
    if (hit !== null) expiries.push(hit + IP_WINDOW_MS);
    const drip = this.#sql.exec("SELECT MIN(at) AS at FROM drips").one().at;
    if (drip !== null) expiries.push(drip + ADDRESS_WINDOW_MS);
    return expiries.length > 0 ? Math.min(...expiries) : null;
  }

  #expire(now) {
    this.#sql.exec("DELETE FROM drips WHERE at <= ?", now - ADDRESS_WINDOW_MS);
    this.#sql.exec("DELETE FROM hits WHERE at <= ?", now - IP_WINDOW_MS);
  }

  /** The drip went out: keep counting it for the rest of its windows. */
  settle(id) {
    this.#sql.exec("UPDATE drips SET settled = 1 WHERE id = ?", id);
  }

  /** The drip failed: hand the address and the per-IP allowance back. */
  release(id) {
    this.#sql.exec("DELETE FROM hits WHERE drip = ?", id);
    this.#sql.exec("DELETE FROM drips WHERE id = ?", id);
  }
}

function seconds(ms) {
  return Math.max(1, Math.ceil(ms / 1000));
}
