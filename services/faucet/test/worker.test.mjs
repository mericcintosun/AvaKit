import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID, startMockChain } from "./helpers/mock-chain.mjs";
import { startMockTurnstile } from "./helpers/mock-turnstile.mjs";
import { startWorker } from "./helpers/workerd.mjs";

/**
 * The whole faucet — Worker, Durable Object and SQLite — running in local
 * workerd from the real wrangler.toml, against a mock chain. Everything here
 * goes through HTTP, so it describes what a caller can observe.
 */

const IP_MAX = 20;
/** Drips one client may have in flight at once. */
const CLIENT_MAX_ACTIVE = 8;
/** Failed attempts one client is allowed in any five minutes. */
const FAILURE_MAX = 10;
const FAILURE_WINDOW_S = 5 * 60;

// Generated per run: no key is ever written down, and none of these hold funds.
const key = generatePrivateKey();
const faucetAddress = privateKeyToAccount(key).address;

const chain = await startMockChain();
/**
 * Every setting the Worker reads, spelled out, so nothing is left to a local
 * .dev.vars or to wrangler.toml. The daily budgets are far above anything
 * these tests send: the storage, and so today's count, is shared by the whole
 * file, and the tests of the budgets size them from that count.
 */
const env = (overrides = {}) => ({
  AVAKIT_FAUCET_KEY: key,
  FAUCET_FUJI_RPC: chain.url,
  FAUCET_DRIP_AVAX: "0.02",
  FAUCET_CORS_ORIGIN: "*",
  FAUCET_DAILY_DRIPS: "100000",
  FAUCET_DAILY_DRIPS_VERIFIED: "100000",
  FAUCET_LOW_BALANCE_AVAX: "1",
  FAUCET_PAUSED: "",
  TURNSTILE_SECRET: "",
  TURNSTILE_ORIGINS: "",
  TURNSTILE_VERIFY_URL: "",
  GIT_SHA: "",
  ...overrides,
});
const worker = await startWorker(env());

after(async () => {
  await worker.close();
  await chain.close();
});
beforeEach(() => {
  chain.reset();
  chain.balance = parseEther("10");
  worker.clearLogs();
});

const someAddress = () => privateKeyToAccount(generatePrivateKey()).address;

// The limits are kept across tests, so every test gets clients of its own.
let clients = 0;
const someIp = () => {
  clients += 1;
  return `198.18.${clients >> 8}.${clients & 0xff}`;
};
const someSubnet = () => {
  clients += 1;
  return `2001:db8:${clients.toString(16)}:1`;
};

/** Send a request and read the whole answer. */
async function call(path, init) {
  const response = await worker.fetch(path, init);
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    text,
    body: text ? JSON.parse(text) : null,
  };
}

/** POST /fund, by default for a new address from a new client. `headers` go on the request. */
function fund({ ip = someIp(), address = someAddress(), headers = {}, ...rest } = {}) {
  return call("/fund", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...headers },
    body: JSON.stringify({ address, ...rest }),
  });
}

/** POST /fund the way the AvaKit client does: a busy faucet is asked again. */
async function fundPatiently(options) {
  for (;;) {
    const result = await fund(options);
    if (result.body?.code !== "faucet_busy") return result;
    await sleep(20);
  }
}

const statuses = (results) => results.map((result) => result.status);
const count = (results, status) => statuses(results).filter((s) => s === status).length;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Today's date, UTC, as /health names it. */
const utcDay = () => new Date().toISOString().slice(0, 10);
/** Seconds until 00:00 UTC, which is when a spent daily budget is back. */
const secondsToMidnight = () => (DAY_MS - (Date.now() % DAY_MS)) / 1000;
/**
 * The daily counts start over at 00:00 UTC. A test that reads one and then
 * depends on it waits out the last seconds of a day rather than straddle it.
 */
async function awayFromMidnight() {
  if (secondsToMidnight() < 20) await sleep(secondsToMidnight() * 1000 + 1000);
}
/** GET /health, from `origin` if one is given. */
const health = (origin) => call("/health", origin ? { headers: { origin } } : undefined);
/** Today's use of the two daily budgets, according to /health. */
const today = async () => (await health()).body.today;

describe("GET /health", () => {
  it("reports the faucet account, its balance, what a drip is and how much of today is left", async () => {
    const answer = await health();

    assert.equal(answer.status, 200);
    const { today: used, ...state } = answer.body;
    assert.deepEqual(state, {
      ok: true,
      version: "dev",
      address: faucetAddress,
      chainId: CHAIN_ID,
      balance: parseEther("10").toString(),
      low: false,
      lowBelow: "1",
      amount: "0.02",
      turnstile: false,
      paused: false,
    });
    assert.deepEqual(used, {
      day: utcDay(),
      unverified: { drips: used.unverified.drips, max: 100000 },
      verified: { drips: used.verified.drips, max: 100000 },
    });
    // Asked for live, and its answer depends on who asks (`turnstile`).
    assert.equal(answer.headers.get("cache-control"), "no-store");
    assert.equal(answer.headers.get("vary"), "origin");
    // Only the faucet's own balance was asked for, and the key is not in the answer.
    assert.deepEqual(chain.calls, ["eth_getBalance"]);
    assert.ok(!answer.text.includes(key.slice(2)));
  });

  it("promises the amount that a drip then sends, and counts the drip", async () => {
    await awayFromMidnight();
    const before = (await health()).body;

    const funded = await fund();

    assert.equal(funded.body.amount, before.amount);
    assert.equal(chain.accepted[0].value, parseEther(before.amount));
    assert.equal((await today()).unverified.drips, before.today.unverified.drips + 1);
  });

  it("names the commit it was deployed from, and nothing else, as its version", async (t) => {
    t.after(() => worker.configure(env()));
    const sha = "0123456789abcdef0123456789abcdef01234567";

    await worker.configure(env({ GIT_SHA: sha }));
    assert.equal((await health()).body.version, sha);

    await worker.configure(env({ GIT_SHA: "not a commit, maybe a secret" }));
    assert.equal((await health()).body.version, "dev");
  });

  it("says when the balance is low, and when it cannot tell", async (t) => {
    t.after(() => worker.configure(env()));

    chain.balance = parseEther("0.5");
    assert.deepEqual(pick((await health()).body, "balance", "low", "lowBelow"), {
      balance: parseEther("0.5").toString(),
      low: true,
      lowBelow: "1",
    });

    await worker.configure(env({ FAUCET_LOW_BALANCE_AVAX: "0.25" }));
    assert.deepEqual(pick((await health()).body, "low", "lowBelow"), {
      low: false,
      lowBelow: "0.25",
    });

    // The RPC is down: the faucet still answers, and does not pretend to know.
    chain.fail("eth_getBalance", { times: 10, status: 500 });
    const blind = await health();
    assert.equal(blind.status, 200);
    assert.deepEqual(pick(blind.body, "ok", "balance", "low"), {
      ok: true,
      balance: null,
      low: null,
    });
  });
});

/** The named fields of `object`, for an assertion about those alone. */
function pick(object, ...names) {
  return Object.fromEntries(names.map((name) => [name, object[name]]));
}

describe("with FAUCET_PAUSED set", () => {
  before(() => worker.configure(env({ FAUCET_PAUSED: "1" })));
  after(() => worker.configure(env()));

  it("refuses every drip before doing any work", async () => {
    const results = await Promise.all([
      fund(),
      // Not even a malformed request gets further.
      call("/fund", { method: "POST", body: "{not json" }),
    ]);

    for (const refused of results) {
      assert.equal(refused.status, 503);
      assert.deepEqual(refused.body, {
        error: "The faucet is paused. Try again later.",
        code: "faucet_paused",
      });
      assert.equal(refused.headers.get("retry-after"), null);
    }
    assert.deepEqual(chain.calls, []);
  });

  it("says so in /health, which keeps answering", async () => {
    const answer = await health();
    assert.equal(answer.status, 200);
    assert.deepEqual(pick(answer.body, "ok", "paused"), { ok: true, paused: true });
  });

  it("funds again once it is switched off", async () => {
    await worker.configure(env({ FAUCET_PAUSED: "0" }));
    assert.equal((await fund()).status, 200);
    assert.equal((await health()).body.paused, false);
    await worker.configure(env({ FAUCET_PAUSED: "1" }));
  });
});

describe("the daily budget", () => {
  after(() => worker.configure(env()));

  /** Shrink the unverified budget to what has been used today plus `left`. */
  async function leave(left) {
    await awayFromMidnight();
    const used = (await today()).unverified.drips;
    await worker.configure(env({ FAUCET_DAILY_DRIPS: String(used + left) }));
    return used + left;
  }

  it("stops every caller once the day's drips are spent, until 00:00 UTC", async () => {
    const max = await leave(2);

    // Two clients nobody has limited, and then a third.
    assert.deepEqual(statuses([await fund(), await fund()]), [200, 200]);
    const refused = await fund();

    assert.equal(refused.status, 429);
    assert.deepEqual(refused.body, {
      error: "The faucet has sent all the drips it gives out today. Try again after 00:00 UTC.",
      code: "daily_limited",
    });
    const retryAfter = Number(refused.headers.get("retry-after"));
    const expected = secondsToMidnight();
    assert.ok(
      Math.abs(retryAfter - expected) <= 5,
      `retry-after ${retryAfter}, expected ${expected}`,
    );
    assert.equal(chain.accepted.length, 2);

    assert.deepEqual((await today()).unverified, { drips: max, max });
  });

  it("holds exactly when many callers arrive at once", async () => {
    // Every request passes the first look while the others are still asking
    // the RPC; the Durable Object checks again before it takes a slot.
    const max = await leave(3);
    chain.delay = 5;

    const results = await Promise.all(Array.from({ length: 12 }, () => fund()));

    assert.equal(count(results, 200), 3);
    assert.equal(count(results, 429), 9);
    for (const refused of results.filter((result) => result.status === 429)) {
      assert.equal(refused.body.code, "daily_limited");
    }
    assert.equal(chain.accepted.length, 3);
    assert.equal((await today()).unverified.drips, max);
  });

  it("refuses without asking the RPC anything", async () => {
    await leave(0);
    const calls = chain.calls.length;

    const refused = await fund();

    assert.equal(refused.body.code, "daily_limited");
    assert.equal(chain.calls.length, calls);
  });

  it("is not spent by a drip that failed", async () => {
    const max = await leave(1);
    chain.fail("eth_sendRawTransaction", { error: { code: -32000, message: "boom" } });

    assert.equal((await fund()).status, 502);
    assert.equal((await fund()).status, 200);
    assert.equal((await fund()).body.code, "daily_limited");
    assert.equal((await today()).unverified.drips, max);
  });
});

describe("with Turnstile required from avakit.dev only", () => {
  const SECRET = "turnstile-origins-secret";
  const SITE = "https://avakit.dev";
  let turnstile;

  before(async () => {
    turnstile = await startMockTurnstile({ secret: SECRET });
    await worker.configure(
      env({
        TURNSTILE_SECRET: SECRET,
        TURNSTILE_ORIGINS: SITE,
        TURNSTILE_VERIFY_URL: turnstile.url,
      }),
    );
  });
  after(async () => {
    await worker.configure(env());
    await turnstile.close();
  });
  beforeEach(() => {
    turnstile.requests.length = 0;
  });

  /** POST /fund with an Origin header, as a browser on that origin sends it. */
  const fundFrom = (origin, options) =>
    fund({ ...options, ...(origin ? { headers: { origin } } : {}) });

  it("refuses avakit.dev without a token, before doing any work", async () => {
    const refused = await fundFrom(SITE);

    assert.equal(refused.status, 403);
    assert.deepEqual(refused.body, { error: "Verification required.", code: "turnstile_required" });
    assert.equal(turnstile.requests.length, 0);
    assert.deepEqual(chain.calls, []);
  });

  it("serves every other caller without one, from the unverified budget", async () => {
    await awayFromMidnight();
    const before = await today();

    // A scaffolded app on localhost, and the MCP server, which sends no Origin.
    const results = [await fundFrom("http://localhost:3000"), await fundFrom(null)];

    assert.deepEqual(statuses(results), [200, 200]);
    assert.equal(turnstile.requests.length, 0);
    const after = await today();
    assert.equal(after.unverified.drips, before.unverified.drips + 2);
    assert.equal(after.verified.drips, before.verified.drips);
  });

  it("draws a request with a good token on the verified budget, from any origin", async () => {
    await awayFromMidnight();
    const before = await today();

    const results = [
      await fundFrom(SITE, { turnstileToken: turnstile.issue("origins-good-1") }),
      await fundFrom("http://localhost:3000", {
        turnstileToken: turnstile.issue("origins-good-2"),
      }),
    ];

    assert.deepEqual(statuses(results), [200, 200]);
    assert.equal(turnstile.requests.length, 2);
    const after = await today();
    assert.equal(after.verified.drips, before.verified.drips + 2);
    assert.equal(after.unverified.drips, before.unverified.drips);
  });

  it("checks a token whenever one is sent, and refuses a bad one", async () => {
    const refused = await fundFrom("http://localhost:3000", { turnstileToken: "forged" });

    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, "turnstile_failed");
    assert.equal(chain.accepted.length, 0);
  });

  it("keeps the site's budget when a script has spent the open one", async () => {
    await awayFromMidnight();
    const { unverified } = await today();
    await worker.configure(
      env({
        TURNSTILE_SECRET: SECRET,
        TURNSTILE_ORIGINS: SITE,
        TURNSTILE_VERIFY_URL: turnstile.url,
        FAUCET_DAILY_DRIPS: String(unverified.drips),
      }),
    );

    const script = await fundFrom(null);
    const visitor = await fundFrom(SITE, { turnstileToken: turnstile.issue("origins-good-3") });

    assert.equal(script.body.code, "daily_limited");
    assert.equal(visitor.status, 200);
  });

  it("answers /health for the origin it is asked from", async () => {
    assert.equal((await health(SITE)).body.turnstile, true);
    assert.equal((await health("http://localhost:3000")).body.turnstile, false);
    assert.equal((await health()).body.turnstile, false);
  });
});

describe("POST /fund", () => {
  it("sends the drip and returns its transaction hash", async () => {
    const address = someAddress();

    const funded = await fund({ address });

    assert.equal(funded.status, 200);
    assert.equal(funded.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(Object.keys(funded.body).sort(), ["amount", "chainId", "txHash"]);
    assert.equal(funded.body.amount, "0.02");
    assert.equal(funded.body.chainId, CHAIN_ID);

    assert.equal(chain.accepted.length, 1);
    const [sent] = chain.accepted;
    assert.equal(sent.hash, funded.body.txHash);
    assert.equal(sent.from, faucetAddress);
    assert.equal(sent.to.toLowerCase(), address.toLowerCase());
    assert.equal(sent.value, parseEther("0.02"));
  });

  it("turns away a malformed request before it reaches the chain", async () => {
    const post = (body) =>
      call("/fund", { method: "POST", headers: { "cf-connecting-ip": someIp() }, body });

    const results = await Promise.all([
      post("{not json"),
      post(JSON.stringify({})),
      post(JSON.stringify({ address: "0x1234" })),
      // Avalanche mainnet: the allowlist is what keeps real funds out of reach.
      post(JSON.stringify({ address: someAddress(), chainId: 43114 })),
      post(JSON.stringify({ address: someAddress(), chainId: "nope" })),
    ]);

    assert.deepEqual(
      results.map((result) => [result.status, result.body.code]),
      [
        [400, "invalid_json"],
        [400, "invalid_address"],
        [400, "invalid_address"],
        [400, "unsupported_chain"],
        [400, "unsupported_chain"],
      ],
    );
    assert.equal(results[3].body.error, "Unsupported or non-testnet chainId 43114.");
    assert.deepEqual(chain.calls, []);
  });

  it("answers a preflight and an unknown path", async () => {
    const preflight = await call("/fund", { method: "OPTIONS" });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    assert.equal(preflight.headers.get("access-control-expose-headers"), "retry-after");

    const missing = await call("/nope");
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: "Not found.", code: "not_found" });
  });
});

describe("rate limits", () => {
  it(`caps one client at ${IP_MAX} drips even when the requests arrive together`, async () => {
    // The KV counter was read, awaited on and written back, so a burst all read
    // "0 so far" and every request passed the check. (One client only gets a
    // few drips in flight at a time; the rest are told to ask again, and do.)
    const ip = someIp();
    chain.delay = 5;

    const results = await Promise.all(
      Array.from({ length: 2 * IP_MAX }, () => fundPatiently({ ip })),
    );

    assert.equal(count(results, 200), IP_MAX);
    assert.equal(count(results, 429), IP_MAX);
    assert.equal(chain.accepted.length, IP_MAX);

    const refused = results.find((result) => result.status === 429);
    assert.deepEqual(refused.body, {
      error: "Rate limit reached. Try again later.",
      code: "ip_limited",
    });
    const retryAfter = Number(refused.headers.get("retry-after"));
    assert.ok(retryAfter > 3500 && retryAfter <= 3600, `retry-after was ${retryAfter}`);
  });

  it("counts every address in an IPv6 /64 as one client", async () => {
    // One subscriber owns the whole /64, so rotating through it used to give a
    // fresh allowance on every request.
    const subnet = someSubnet();
    const results = [];
    for (let host = 1; host <= IP_MAX + 10; host += 1) {
      results.push(await fund({ ip: `${subnet}::${host.toString(16)}` }));
    }

    assert.deepEqual(statuses(results), [...Array(IP_MAX).fill(200), ...Array(10).fill(429)]);
    // The next /64 over is somebody else.
    assert.equal((await fund({ ip: `${someSubnet()}::1` })).status, 200);
  });

  it("funds an address once a day, whoever asks", async () => {
    const address = someAddress();
    assert.equal((await fund({ address })).status, 200);
    const calls = chain.calls.length;

    const again = await fund({ address });

    assert.equal(chain.calls.length, calls, "a refused request costs no RPC call");
    assert.equal(again.status, 429);
    assert.deepEqual(again.body, {
      error: "This address was funded recently. Try again later.",
      code: "address_limited",
    });
    const retryAfter = Number(again.headers.get("retry-after"));
    assert.ok(retryAfter > 86_000 && retryAfter <= 86_400, `retry-after was ${retryAfter}`);
    assert.equal(chain.accepted.length, 1);
  });

  it("asks a second request to wait a moment while the address's drip is still being sent", async () => {
    // It used to get the 24-hour refusal — for a drip that then failed, which
    // left the address free again at once and the caller with a wrong wait.
    const address = someAddress();
    chain.delay = (method) => (method === "eth_sendRawTransaction" ? 500 : 0);
    chain.fail("eth_sendRawTransaction", { error: { code: -32000, message: "boom" } });

    const first = fund({ address });
    await sleep(200);
    const second = await fund({ address });

    assert.equal(second.status, 503);
    assert.deepEqual(second.body, {
      error: "The faucet is busy. Try again in a few seconds.",
      code: "faucet_busy",
    });
    assert.equal(second.headers.get("retry-after"), "3");

    // The first one fails, so the address can be funded straight away…
    assert.equal((await first).status, 502);
    const third = fund({ address });
    await sleep(200);
    assert.equal((await fund({ address })).status, 503);
    // …and only once a drip has gone out does the day-long limit apply.
    assert.equal((await third).status, 200);
    const fourth = await fund({ address });
    assert.equal(fourth.status, 429);
    assert.equal(fourth.body.code, "address_limited");
  });
});

describe("concurrent drips", () => {
  it("each get their own nonce", async () => {
    // Different people clicking in the same second: each used to read the same
    // pending nonce, and all but one got a 502.
    chain.delay = 5;
    const first = chain.nonceOf(faucetAddress);

    const results = await Promise.all(Array.from({ length: 12 }, () => fund()));

    assert.deepEqual(statuses(results), Array(12).fill(200));
    assert.equal(new Set(results.map((result) => result.body.txHash)).size, 12);
    assert.deepEqual(
      chain.accepted.map((tx) => tx.nonce),
      Array.from({ length: 12 }, (_, i) => first + i),
    );
  });

  it("are turned away once too many are in flight, instead of queueing without bound", async () => {
    // Hold every drip in its first RPC call, so all 80 are in the object at
    // once. It works on 64 and tells the rest to come back.
    chain.delay = (method) => (method === "eth_getBalance" ? 500 : 0);

    const results = await Promise.all(Array.from({ length: 80 }, () => fund()));

    const busy = results.filter((result) => result.status === 503);
    assert.ok(busy.length > 0, "nobody was turned away");
    assert.ok(count(results, 200) >= 64);
    assert.equal(count(results, 200) + busy.length, 80);
    for (const refused of busy) {
      assert.deepEqual(refused.body, {
        error: "The faucet is busy. Try again in a few seconds.",
        code: "faucet_busy",
      });
      assert.equal(refused.headers.get("retry-after"), "3");
    }
    assert.equal(chain.accepted.length, count(results, 200));
  });

  it("cannot all be held by one client", async () => {
    // One client used to be able to take all 64 slots — with drips that only
    // ever fail, for free — and everybody else was told the faucet was busy.
    chain.delay = (method) => (method === "eth_getBalance" ? 500 : 0);
    const hog = someIp();

    const held = Promise.all(Array.from({ length: 70 }, () => fund({ ip: hog })));
    await sleep(100);
    const other = await fund();
    const results = await held;

    assert.equal(other.status, 200, "somebody else is still served");
    assert.equal(count(results, 200), CLIENT_MAX_ACTIVE);
    const busy = results.filter((result) => result.status === 503);
    assert.equal(busy.length, 70 - CLIENT_MAX_ACTIVE);
    for (const refused of busy) {
      assert.equal(refused.body.code, "faucet_busy");
      assert.equal(refused.headers.get("retry-after"), "3");
    }
  });
});

describe("a client whose drips keep failing", () => {
  it("is refused before the RPC is asked again", async () => {
    // Naming a contract that refuses the transfer cost four RPC calls a time
    // and was never recorded, so one client could repeat it without limit.
    const ip = someIp();
    const address = someAddress();
    chain.contract(address, { reverts: true });

    const results = [];
    for (let i = 0; i < FAILURE_MAX; i += 1) results.push(await fund({ ip, address }));
    const calls = chain.calls.length;
    for (let i = 0; i < 5; i += 1) results.push(await fund({ ip, address }));

    assert.deepEqual(statuses(results), [...Array(FAILURE_MAX).fill(400), ...Array(5).fill(429)]);
    assert.equal(chain.calls.length, calls, "a refused request costs no RPC call");
    const refused = results.at(-1);
    assert.deepEqual(refused.body, {
      error: "Rate limit reached. Try again later.",
      code: "ip_limited",
    });
    const retryAfter = Number(refused.headers.get("retry-after"));
    assert.ok(
      retryAfter > FAILURE_WINDOW_S - 60 && retryAfter <= FAILURE_WINDOW_S,
      `retry-after was ${retryAfter}`,
    );

    // It is the client that is refused, whatever it asks for next…
    assert.equal((await fund({ ip })).status, 429);
    // …and nobody else.
    assert.equal((await fund()).status, 200);
  });

  it("is counted when it is the send that fails", async () => {
    const ip = someIp();
    chain.fail("eth_sendRawTransaction", {
      times: FAILURE_MAX + 1,
      error: { code: -32000, message: "boom" },
    });

    const results = [];
    for (let i = 0; i <= FAILURE_MAX; i += 1) results.push(await fund({ ip }));

    assert.deepEqual(statuses(results), [...Array(FAILURE_MAX).fill(502), 429]);
    assert.equal(chain.count("eth_sendRawTransaction"), FAILURE_MAX);
  });

  it("is not blamed for an empty faucet", async () => {
    // Nobody can empty the faucet by choosing a recipient, and "empty" is the
    // answer a visitor needs to see for as long as it is true.
    const ip = someIp();
    chain.balance = parseEther("0.001");

    const results = [];
    for (let i = 0; i < FAILURE_MAX + 2; i += 1) results.push(await fund({ ip }));
    assert.deepEqual(statuses(results), Array(FAILURE_MAX + 2).fill(503));
    assert.equal(results.at(-1).body.code, "faucet_empty");

    chain.balance = parseEther("10");
    assert.equal((await fund({ ip })).status, 200);
  });
});

describe("a recipient that is a contract", () => {
  const REFUSAL = {
    error: "This address is a contract the faucet does not fund. Use a wallet address.",
    code: "contract_recipient",
  };

  it("is refused when paying it costs more gas than paying a wallet", async () => {
    // 15,000,000 gas at 25 nAVAX is 0.375 AVAX from the faucet for a 0.02 drip.
    const address = someAddress();
    chain.contract(address, { gas: 15_000_000 });

    const refused = await fund({ address });

    assert.equal(refused.status, 400);
    assert.deepEqual(refused.body, REFUSAL);
    assert.equal(chain.count("eth_sendRawTransaction"), 0);
  });

  it("is refused when it turns the transfer down", async () => {
    const address = someAddress();
    chain.contract(address, { reverts: true });

    const refused = await fund({ address });

    assert.equal(refused.status, 400);
    assert.deepEqual(refused.body, REFUSAL);
    assert.equal(chain.count("eth_sendRawTransaction"), 0);
  });

  it("is funded when it is no costlier than a smart-contract wallet", async () => {
    const address = someAddress();
    chain.contract(address, { gas: 60_000 });

    assert.equal((await fund({ address })).status, 200);
  });
});

describe("a drip whose send gets no answer", () => {
  it("is reported as sent, and counted, when the node has the transaction", async () => {
    // The node takes the transaction and its answer is lost on the way back
    // (a 502 from a proxy). The old Worker answered 502 and gave the allowance
    // back, so the same address could be funded again and again.
    const ip = someIp();
    const address = someAddress();
    chain.lose("eth_sendRawTransaction");

    const funded = await fund({ ip, address });

    assert.equal(funded.status, 200);
    assert.equal(chain.accepted.length, 1);
    assert.equal(funded.body.txHash, chain.accepted[0].hash);

    const again = await fund({ ip, address });
    assert.equal(again.status, 429);
    assert.equal(again.body.code, "address_limited");
    assert.equal(chain.accepted.length, 1, "the address is not paid twice");

    const logged = worker.logs().filter((entry) => /send answer lost/.test(entry.text));
    assert.equal(logged.length, 1);
    assert.match(logged[0].text, new RegExp(`"txHash":"${funded.body.txHash}","found":true`));
    assert.doesNotMatch(logged[0].text, /SECRET|apikey|127\.0\.0\.1/);
  });

  it(`still stops one client at ${IP_MAX} drips`, async () => {
    const ip = someIp();
    chain.lose("eth_sendRawTransaction", { times: IP_MAX + 1 });

    const results = [];
    for (let i = 0; i <= IP_MAX; i += 1) results.push(await fund({ ip }));

    assert.deepEqual(statuses(results), [...Array(IP_MAX).fill(200), 429]);
    assert.equal(results.at(-1).body.code, "ip_limited");
    assert.equal(chain.accepted.length, IP_MAX);
  });

  it("is a failure the caller can retry when the node does not have the transaction", async () => {
    const ip = someIp();
    const address = someAddress();
    chain.fail("eth_sendRawTransaction", { status: 502 });

    const failed = await fund({ ip, address });

    assert.equal(failed.status, 502);
    assert.equal(failed.body.code, "drip_failed");
    assert.equal(chain.accepted.length, 0);
    const logged = worker.logs().filter((entry) => /send answer lost/.test(entry.text));
    assert.equal(logged.length, 1);
    assert.match(logged[0].text, /"found":false/);

    assert.equal((await fund({ ip, address })).status, 200);
  });
});

describe("a drip that fails", () => {
  it("does not cost the caller their allowance", async () => {
    const ip = someIp();
    for (let i = 1; i < IP_MAX; i += 1) {
      assert.equal((await fund({ ip })).status, 200, `drip ${i}`);
    }

    // The 20th drip fails at the node…
    const address = someAddress();
    chain.fail("eth_sendRawTransaction", { status: 500 });
    assert.equal((await fund({ ip, address })).status, 502);

    // …so the same address can try again, and that is still the 20th. The old
    // Worker released the address but kept the hit, so this retry got a 429.
    assert.equal((await fund({ ip, address })).status, 200);
    assert.equal((await fund({ ip })).status, 429);
  });

  it("tells the caller nothing about the RPC, and logs the reason", async () => {
    const failures = [
      // A transport failure while sending: viem's message carries the URL and the request.
      () => chain.fail("eth_sendRawTransaction", { status: 500 }),
      // The node refusing the transaction outright.
      () => chain.fail("eth_sendRawTransaction", { error: { code: -32000, message: "boom" } }),
      // A failure before anything is sent.
      () => chain.fail("eth_estimateGas", { error: { code: -32000, message: "boom" } }),
    ];
    for (const arrange of failures) {
      worker.clearLogs();
      arrange();

      const failed = await fund();

      assert.equal(failed.status, 502);
      assert.deepEqual(failed.body, {
        error: "The faucet could not send the drip. Try again shortly.",
        code: "drip_failed",
      });
      assert.doesNotMatch(failed.text, /SECRET|apikey|127\.0\.0\.1|Request body|viem/i);

      const errors = worker.logs().filter((entry) => entry.level === "error");
      assert.equal(errors.length, 1);
      assert.match(errors[0].text, /"message":"drip failed"/);
      assert.doesNotMatch(errors[0].text, /SECRET|apikey|127\.0\.0\.1/);
    }
  });

  it("says so when the faucet is empty, and takes nothing from the caller", async () => {
    const ip = someIp();
    const address = someAddress();
    chain.balance = parseEther("0.001");

    const empty = await fund({ ip, address });

    assert.equal(empty.status, 503);
    assert.deepEqual(empty.body, {
      error: "Faucet is empty. Please top it up.",
      code: "faucet_empty",
    });
    assert.equal(chain.accepted.length, 0);

    chain.balance = parseEther("10");
    assert.equal((await fund({ ip, address })).status, 200);
  });
});

describe("with TURNSTILE_SECRET set", () => {
  const SECRET = "turnstile-test-secret";
  let turnstile;

  before(async () => {
    turnstile = await startMockTurnstile({ secret: SECRET });
    await worker.configure(env({ TURNSTILE_SECRET: SECRET, TURNSTILE_VERIFY_URL: turnstile.url }));
  });
  after(async () => {
    await worker.configure(env());
    await turnstile.close();
  });
  beforeEach(() => {
    turnstile.requests.length = 0;
    turnstile.down = false;
  });

  it("says in /health that a token is expected", async () => {
    assert.equal((await call("/health")).body.turnstile, true);
  });

  it("refuses a request without a token before doing any work", async () => {
    const refused = await fund();

    assert.equal(refused.status, 403);
    assert.deepEqual(refused.body, { error: "Verification required.", code: "turnstile_required" });
    assert.equal(turnstile.requests.length, 0);
    assert.deepEqual(chain.calls, []);
  });

  it("funds a caller whose token Cloudflare vouches for", async () => {
    const ip = someIp();
    const token = turnstile.issue("good-token-1");

    const funded = await fund({ ip, turnstileToken: token });

    assert.equal(funded.status, 200);
    assert.deepEqual(turnstile.requests, [{ secret: SECRET, response: token, remoteip: ip }]);
    assert.equal(chain.accepted.length, 1);
  });

  it("refuses a token that is wrong or already spent", async () => {
    const token = turnstile.issue("good-token-2");
    assert.equal((await fund({ turnstileToken: token })).status, 200);

    const results = await Promise.all([
      fund({ turnstileToken: token }),
      fund({ turnstileToken: "forged" }),
    ]);

    for (const refused of results) {
      assert.equal(refused.status, 403);
      assert.deepEqual(refused.body, {
        error: "Verification failed. Try again.",
        code: "turnstile_failed",
      });
    }
    assert.equal(chain.accepted.length, 1);
  });

  it("refuses everyone while verification is down", async () => {
    turnstile.down = true;

    const refused = await fund({ turnstileToken: turnstile.issue("good-token-3") });

    assert.equal(refused.status, 503);
    assert.equal(refused.body.code, "turnstile_unavailable");
    assert.equal(chain.accepted.length, 0);
  });
});

describe("a misconfigured faucet", () => {
  after(() => worker.configure(env()));

  const answer = ({ status, body }) => [status, body];
  /** What /health answers for a setting it cannot use: the same words, as a failed health check. */
  const unhealthy = ([status, body]) => [status, { ok: false, version: "dev", ...body }];

  it("says the key is missing", async () => {
    await worker.configure(env({ AVAKIT_FAUCET_KEY: "" }));
    const expected = [500, { error: "Faucet key not configured.", code: "misconfigured" }];

    assert.deepEqual(answer(await call("/health")), unhealthy(expected));
    assert.deepEqual(answer(await fund()), expected);
  });

  it("answers with JSON, not a crash, when the key is not a private key", async () => {
    // All zeroes is the placeholder .env.example ships.
    await worker.configure(env({ AVAKIT_FAUCET_KEY: `0x${"00".repeat(32)}` }));
    const expected = [
      500,
      { error: "Faucet key is not a valid private key.", code: "misconfigured" },
    ];

    const health = await call("/health");
    assert.equal(health.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(answer(health), unhealthy(expected));
    assert.deepEqual(answer(await fund()), expected);
    assert.deepEqual(chain.calls, []);
  });

  it("refuses to guess a drip amount", async () => {
    await worker.configure(env({ FAUCET_DRIP_AVAX: "lots" }));
    const expected = [
      500,
      { error: "FAUCET_DRIP_AVAX is not a valid amount.", code: "misconfigured" },
    ];

    assert.deepEqual(answer(await fund()), expected);
    assert.equal(chain.accepted.length, 0);
    // /health says so too, rather than naming an amount no drip will send.
    assert.deepEqual(answer(await call("/health")), unhealthy(expected));
  });

  it("refuses to run without a daily budget it can read", async () => {
    await worker.configure(env({ FAUCET_DAILY_DRIPS: "lots" }));
    const expected = [
      500,
      { error: "FAUCET_DAILY_DRIPS is not a whole number.", code: "misconfigured" },
    ];

    assert.deepEqual(answer(await fund()), expected);
    assert.equal(chain.accepted.length, 0);
    assert.deepEqual(answer(await call("/health")), unhealthy(expected));
  });

  it("reports in /health a setting that only matters later", async () => {
    // Caught here, by the check after a deploy, rather than once the
    // Turnstile secret is set or the balance runs low.
    for (const [setting, value, error] of [
      ["TURNSTILE_ORIGINS", "avakit.dev", "TURNSTILE_ORIGINS is not a list of origins."],
      ["FAUCET_LOW_BALANCE_AVAX", "-1", "FAUCET_LOW_BALANCE_AVAX is not a valid amount."],
      ["FAUCET_DAILY_DRIPS_VERIFIED", "1.5", "FAUCET_DAILY_DRIPS_VERIFIED is not a whole number."],
    ]) {
      await worker.configure(env({ [setting]: value }));
      assert.deepEqual(
        answer(await call("/health")),
        unhealthy([500, { error, code: "misconfigured" }]),
        setting,
      );
    }
  });
});
