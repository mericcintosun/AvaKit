import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { startWorker } from "./helpers/workerd.mjs";

/**
 * The first deploy of the daily budgets opens a table the hosted faucet has
 * held since before them. limits.test.mjs covers the upgrade in Node's SQLite;
 * this runs it in workerd, whose SQLite refuses statements a Durable Object
 * may not run — a refusal here would take every drip down after the deploy.
 */

const worker = await startWorker({}, { config: "./test/fixtures/upgrade/wrangler.toml" });
after(() => worker.close());

async function call(method, args) {
  const response = await worker.fetch("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, args }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

describe("a drips table from before the daily budgets, in workerd", () => {
  it("gains the lane column, keeps its drips and counts them as unverified", async () => {
    const at = Date.now();
    const address = `0x${"ab".repeat(20)}`;
    const day = new Date(at).toISOString().slice(0, 10);
    assert.deepEqual(await call("legacy", { address, at }), { drips: 1 });

    const opened = await call("open", { address, at });

    assert.deepEqual(opened.columns, ["id", "address", "at", "settled", "lane"]);
    assert.deepEqual(opened.usage, { day, unverified: 1, verified: 0 });
    assert.equal(opened.refusal?.code, "address_limited");

    // The next start of the object finds the column there and leaves it be.
    assert.deepEqual(await call("open", { address, at }), opened);
  });
});
