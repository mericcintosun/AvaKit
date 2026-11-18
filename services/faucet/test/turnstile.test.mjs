import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyTurnstile } from "../src/turnstile.js";

const SECRET = "test-turnstile-secret";

const siteverify = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Stand in for Cloudflare for one test: `fetch` answers with whatever
 * `stub.respond` returns and records what it was asked. Rejected tokens are
 * logged with `console.warn`, which is captured too.
 */
function stubCloudflare(t, respond = () => siteverify({ success: true })) {
  const stub = { respond, calls: [], warn: t.mock.method(console, "warn", () => {}) };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    stub.calls.push({ url: String(url), method: init.method, body: JSON.parse(init.body) });
    return stub.respond();
  });
  return stub;
}

describe("verifyTurnstile", () => {
  it("asks Cloudflare and accepts a token it vouches for", async (t) => {
    const cloudflare = stubCloudflare(t);

    const verdict = await verifyTurnstile({ secret: SECRET, token: "tok", ip: "203.0.113.9" });

    assert.equal(verdict, "ok");
    assert.deepEqual(cloudflare.calls, [
      {
        url: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        method: "POST",
        body: { secret: SECRET, response: "tok", remoteip: "203.0.113.9" },
      },
    ]);
  });

  it("leaves remoteip out when the client address is unknown", async (t) => {
    const cloudflare = stubCloudflare(t);
    await verifyTurnstile({ secret: SECRET, token: "tok", ip: null });
    assert.deepEqual(cloudflare.calls[0].body, { secret: SECRET, response: "tok" });
  });

  it("refuses a token Cloudflare rejects", async (t) => {
    const cloudflare = stubCloudflare(t);
    const rejections = [
      { success: false, "error-codes": ["timeout-or-duplicate"] },
      { success: false, "error-codes": ["invalid-input-response"] },
      { success: false, "error-codes": ["bad-request"] },
      { success: false },
    ];
    for (const rejection of rejections) {
      cloudflare.respond = () => siteverify(rejection);
      assert.equal(await verifyTurnstile({ secret: SECRET, token: "tok" }), "failed");
    }
  });

  it("refuses something that cannot be a token without asking anyone", async (t) => {
    const cloudflare = stubCloudflare(t);
    for (const token of ["", undefined, null, 42, { a: 1 }, "x".repeat(2049)]) {
      assert.equal(await verifyTurnstile({ secret: SECRET, token }), "failed");
    }
    assert.equal(cloudflare.calls.length, 0);
  });

  it("fails closed when the problem is on our side", async (t) => {
    const cloudflare = stubCloudflare(t);
    const outages = [
      () => siteverify({ success: false, "error-codes": ["invalid-input-secret"] }),
      () => siteverify({ success: false, "error-codes": ["missing-input-secret"] }),
      () => siteverify({ success: false, "error-codes": ["internal-error"] }),
      () => siteverify({ success: true }, 500),
      () => new Response("<html>bad gateway</html>", { status: 200 }),
      () => {
        throw new TypeError("fetch failed");
      },
    ];
    for (const outage of outages) {
      cloudflare.respond = outage;
      assert.equal(await verifyTurnstile({ secret: SECRET, token: "tok" }), "unavailable");
    }
  });

  it("logs Cloudflare's error codes but never the token or the secret", async (t) => {
    const cloudflare = stubCloudflare(t, () =>
      siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] }),
    );

    await verifyTurnstile({ secret: SECRET, token: "visitor-token" });

    assert.equal(cloudflare.warn.mock.callCount(), 1);
    const logged = String(cloudflare.warn.mock.calls[0].arguments[0]);
    assert.match(logged, /timeout-or-duplicate/);
    assert.doesNotMatch(logged, /visitor-token|test-turnstile-secret/);
  });
});
