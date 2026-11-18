import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/** What the tests driving a collector from `loadWorker()` have in common. */

/** 2026-11-18, mid-morning UTC: where `clock()` starts every test. */
export const T0 = Date.UTC(2026, 10, 18, 9, 0, 0);
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const DAY = 24 * 60 * MINUTE;
/** How long the collector serves one computed aggregate for. */
export const STATS_TTL = 5 * MINUTE;

/** Freeze the clock at T0; `tick(ms)` moves it. */
export function clock(t) {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  return (ms) => t.mock.timers.tick(ms);
}

/** POST one scaffold event, successful and from a new machine unless told otherwise. */
export function scaffold(collector, { ip = "203.0.113.9", ...fields } = {}) {
  return collector.fetch("/e", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({
      event: "scaffold",
      anonymousId: randomUUID(),
      template: "minimal",
      chain: "fuji",
      pm: "pnpm",
      ok: true,
      cliVersion: "0.2.1",
      platform: "darwin",
      nodeMajor: "24",
      ...fields,
    }),
  });
}

/** GET /stats: the aggregate, plus the `cache-control` it came with. */
export async function stats(collector) {
  const response = await collector.fetch("/stats");
  assert.equal(response.status, 200);
  return { cacheControl: response.headers.get("cache-control"), ...(await response.json()) };
}
