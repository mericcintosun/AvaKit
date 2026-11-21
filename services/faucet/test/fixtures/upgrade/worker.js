import { DurableObject } from "cloudflare:workers";
import { DripLimits } from "../../../src/limits.js";

/**
 * The hosted faucet's Durable Object was created before the daily budgets, so
 * its `drips` table has no `lane` column, and the next deploy opens that table
 * with the current DripLimits. This object does the same in local workerd:
 * `legacy` writes the old table exactly as the old code created it, and `open`
 * runs today's constructor over it.
 */
export class Upgrade extends DurableObject {
  legacy({ address, at }) {
    const { sql } = this.ctx.storage;
    sql.exec(`
      CREATE TABLE drips (
        id INTEGER PRIMARY KEY,
        address TEXT NOT NULL,
        at INTEGER NOT NULL,
        settled INTEGER NOT NULL DEFAULT 0
      )
    `);
    sql.exec("CREATE INDEX drips_address ON drips (address, at)");
    sql.exec("CREATE INDEX drips_at ON drips (at)");
    sql.exec("CREATE INDEX drips_unsettled ON drips (settled) WHERE settled = 0");
    sql.exec("INSERT INTO drips (address, at, settled) VALUES (?, ?, 1)", address, at);
    return { drips: sql.exec("SELECT COUNT(*) AS n FROM drips").one().n };
  }

  open({ address, at }) {
    const { sql } = this.ctx.storage;
    const limits = new DripLimits(sql);
    return {
      columns: sql
        .exec("PRAGMA table_info(drips)")
        .toArray()
        .map((column) => column.name),
      usage: limits.usage(at),
      refusal: limits.refusal({ address, client: "203.0.113.9" }, at),
    };
  }
}

export default {
  async fetch(request, env) {
    const { method, args } = await request.json();
    const upgrade = env.UPGRADE.get(env.UPGRADE.idFromName("upgrade"));
    if (method === "legacy") return Response.json(await upgrade.legacy(args));
    if (method === "open") return Response.json(await upgrade.open(args));
    return new Response("Not found.", { status: 404 });
  },
};
