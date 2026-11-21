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

/** Call `method` on the Durable Object named `object`; each test uses its own. */
async function call(method, args, object = "upgrade") {
  const response = await worker.fetch("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, args, object }),
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

  it("still works with the code before the budgets if the deploy is rolled back", async () => {
    const at = Date.now();
    const before = `0x${"cd".repeat(20)}`;
    const during = `0x${"ef".repeat(20)}`;
    const day = new Date(at).toISOString().slice(0, 10);
    await call("legacy", { address: before, at }, "rollback");
    await call("open", { address: before, at }, "rollback");

    // The old code leaves `lane` out of its INSERT, so the column's default applies.
    const rolledBack = await call("rolledBack", { address: during, at }, "rollback");

    assert.equal(rolledBack.refused, undefined);
    assert.equal(rolledBack.lane, "unverified");
    assert.equal(rolledBack.refusal?.code, "address_limited");

    // Deployed again, the budgets count the drip the old code sent.
    const redeployed = await call("open", { address: during, at }, "rollback");
    assert.deepEqual(redeployed.usage, { day, unverified: 2, verified: 0 });
    assert.equal(redeployed.refusal?.code, "address_limited");
  });
});
