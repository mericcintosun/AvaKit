import { afterEach, describe, expect, it, vi } from "vitest";
import { FaucetError, type FaucetErrorCode } from "./errors.js";
import { AVAKIT_FAUCET_URL, backoffDelay, type FaucetResult, requestFaucet } from "./faucet.js";
import * as entry from "./index.js";

const FAUCET = "https://faucet.example/drip";
const ADDRESS = "0x000000000000000000000000000000000000dEaD";

type Fetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

function stubFetch(respond: (init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn<Fetch>((_url, init) => Promise.resolve().then(() => respond(init)));
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** Answer the attempts in order; the last answer repeats. An Error is a request that never arrived. */
function stubAnswers(...answers: Array<(() => Response) | Error>) {
  let attempt = 0;
  return stubFetch(() => {
    const answer = answers[Math.min(attempt, answers.length - 1)];
    attempt += 1;
    if (answer === undefined || answer instanceof Error) {
      throw answer ?? new Error("no answer stubbed");
    }
    return answer();
  });
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A faucet that takes the request and never answers, until the request is aborted. */
function stubHangingFetch() {
  const spy = vi.fn<Fetch>(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("This operation was aborted", "AbortError")),
          { once: true },
        );
      }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** How a request ended, captured so a rejection is never left unhandled while timers run. */
function settle(request: Promise<FaucetResult>) {
  return request.then(
    (result) => ({ result, error: null }),
    (error: unknown) => ({ result: null, error: error as FaucetError }),
  );
}

/** The JSON body of the `index`-th request. */
function sentBody(spy: ReturnType<typeof stubFetch>, index = 0): Record<string, unknown> {
  return JSON.parse(String(spy.mock.calls[index]?.[1]?.body)) as Record<string, unknown>;
}

/** Make every backoff wait zero, so retries run back to back. */
function noJitter() {
  vi.spyOn(Math, "random").mockReturnValue(0);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("requestFaucet", () => {
  it("posts the address and chain id and returns what the faucet reports", async () => {
    const spy = stubFetch(() => json({ txHash: "0xabc", amount: "0.5" }));

    const result = await requestFaucet({ url: FAUCET, address: ADDRESS, chainId: 43113 });

    expect(result).toEqual({ txHash: "0xabc", amount: "0.5" });
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url).toBe(FAUCET);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ address: ADDRESS, chainId: 43113 });
  });

  it("reports a refusal with the faucet's own message and the HTTP status", async () => {
    stubFetch(() => json({ error: "This address was funded less than 24 hours ago." }, 429));

    const request = requestFaucet({ url: FAUCET, address: ADDRESS });

    await expect(request).rejects.toBeInstanceOf(FaucetError);
    await expect(request).rejects.toThrow("funded less than 24 hours ago");
    await expect(request).rejects.toHaveProperty("status", 429);
  });

  it("still reports the status when a refusal carries no JSON body", async () => {
    noJitter();
    stubFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));

    const request = requestFaucet({ url: FAUCET, address: ADDRESS });

    await expect(request).rejects.toBeInstanceOf(FaucetError);
    await expect(request).rejects.toThrow("HTTP 502");
    await expect(request).rejects.toHaveProperty("status", 502);
  });

  it("turns a network failure into a FaucetError", async () => {
    noJitter();
    const cause = new TypeError("Failed to fetch");
    stubAnswers(cause);

    const { error } = await settle(requestFaucet({ url: FAUCET, address: ADDRESS }));

    expect(error).toBeInstanceOf(FaucetError);
    expect(error?.message).toContain("Failed to fetch");
    // No status: the faucet never answered. Callers tell the two cases apart by it.
    expect(error?.status).toBeUndefined();
    expect(error?.code).toBe("network");
    expect(error?.retryable).toBe(true);
    expect(error?.cause).toBe(cause);
  });

  it("falls back to the status when the error field is not a message", async () => {
    stubFetch(() => json({ error: { detail: "nope" } }, 400));

    const { error } = await settle(requestFaucet({ url: FAUCET, address: ADDRESS }));

    expect(error?.message).toBe("Faucet request failed (HTTP 400).");
  });

  it("returns an empty result for a success that is not a JSON object", async () => {
    for (const body of ["", "ok", "null", "[1]", '"done"']) {
      stubFetch(() => new Response(body, { status: 200 }));

      await expect(requestFaucet({ url: FAUCET, address: ADDRESS })).resolves.toEqual({});
    }
  });

  // What a wrong faucet URL gets from a site that serves its app for every
  // path: a page, with a 200. Reading that as a drip would report "funded" for
  // funds nobody sent.
  it("does not take a web page for a drip, even with a 200", async () => {
    for (const page of [
      "<!doctype html><html><body>My app</body></html>",
      "\n  <html><head></head></html>",
      '<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>',
    ]) {
      const spy = stubFetch(
        () => new Response(page, { status: 200, headers: { "content-type": "text/html" } }),
      );

      const { result, error } = await settle(
        requestFaucet({ url: FAUCET, address: ADDRESS, retries: 3 }),
      );

      expect(result).toBeNull();
      expect(error).toBeInstanceOf(FaucetError);
      expect(error?.code).toBe("invalid");
      expect(error?.retryable).toBe(false);
      expect(error?.status).toBe(200);
      expect(error?.message).toMatch(/web page, not a faucet's JSON/);
      // The same wrong URL would only answer the same way again.
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  it("judges a page by its body, not by a content type a plain answer may carry", async () => {
    stubFetch(() => new Response("OK", { status: 200, headers: { "content-type": "text/html" } }));

    await expect(requestFaucet({ url: FAUCET, address: ADDRESS })).resolves.toEqual({});
  });
});

describe("requestFaucet failures are typed", () => {
  const byStatus: Array<[status: number, code: FaucetErrorCode, retryable: boolean]> = [
    [400, "invalid", false],
    [401, "invalid", false],
    [403, "invalid", false],
    [404, "invalid", false],
    [429, "rate_limited", false],
    [503, "empty", false],
    [500, "unavailable", true],
    [502, "unavailable", true],
    [504, "unavailable", true],
  ];

  // The faucet in production today answers `{ error }` and nothing else.
  it.each(byStatus)("maps HTTP %i without a code to %s", async (status, code, retryable) => {
    stubFetch(() => json({ error: "refused" }, status));

    const { error } = await settle(
      requestFaucet({ url: FAUCET, address: ADDRESS, retries: 0, chainId: 43113 }),
    );

    expect(error).toBeInstanceOf(FaucetError);
    expect(error?.code).toBe(code);
    expect(error?.retryable).toBe(retryable);
    expect(error?.status).toBe(status);
    expect(error?.message).toBe("refused");
    expect(error?.faucetCode).toBeUndefined();
    expect(error?.retryAfterMs).toBeUndefined();
  });

  const byFaucetCode: Array<
    [status: number, faucetCode: string, code: FaucetErrorCode, retryable: boolean]
  > = [
    [400, "invalid_json", "invalid", false],
    [400, "invalid_address", "invalid", false],
    [400, "unsupported_chain", "invalid", false],
    [403, "turnstile_required", "invalid", false],
    [403, "turnstile_failed", "invalid", false],
    [404, "not_found", "invalid", false],
    [400, "contract_recipient", "invalid", false],
    [429, "address_limited", "rate_limited", false],
    [429, "ip_limited", "rate_limited", false],
    [503, "faucet_empty", "empty", false],
    // The cases the status alone gets wrong: 503 is not always "empty".
    [503, "faucet_busy", "unavailable", true],
    [503, "turnstile_unavailable", "unavailable", true],
    [502, "drip_failed", "unavailable", true],
    [500, "misconfigured", "unavailable", true],
    [500, "internal", "unavailable", true],
  ];

  // The rewritten faucet Worker answers `{ error, code }`.
  it.each(
    byFaucetCode,
  )("maps HTTP %i with code %s to %s", async (status, faucetCode, code, retryable) => {
    stubFetch(() => json({ error: "refused", code: faucetCode }, status));

    const { error } = await settle(requestFaucet({ url: FAUCET, address: ADDRESS, retries: 0 }));

    expect(error?.code).toBe(code);
    expect(error?.retryable).toBe(retryable);
    expect(error?.status).toBe(status);
    expect(error?.faucetCode).toBe(faucetCode);
    expect(error?.message).toBe("refused");
  });

  it("prefers the faucet's code over the status", async () => {
    // A 503 means "empty" by status, but this one says it is merely busy.
    stubFetch(() => json({ error: "Busy.", code: "faucet_busy" }, 503));
    const busy = await settle(requestFaucet({ url: FAUCET, address: ADDRESS, retries: 0 }));

    stubFetch(() => json({ error: "Empty." }, 503));
    const empty = await settle(requestFaucet({ url: FAUCET, address: ADDRESS, retries: 0 }));

    expect(busy.error?.code).toBe("unavailable");
    expect(busy.error?.retryable).toBe(true);
    expect(empty.error?.code).toBe("empty");
    expect(empty.error?.retryable).toBe(false);
  });

  it("falls back to the status for a code it does not know", async () => {
    stubFetch(() => json({ error: "New refusal.", code: "something_new" }, 429));

    const { error } = await settle(requestFaucet({ url: FAUCET, address: ADDRESS }));

    expect(error?.code).toBe("rate_limited");
    expect(error?.faucetCode).toBe("something_new");
  });

  it("is not fooled by a code that names an Object.prototype member", async () => {
    stubFetch(() => json({ error: "Odd.", code: "constructor" }, 400));

    const { error } = await settle(requestFaucet({ url: FAUCET, address: ADDRESS }));

    expect(error?.code).toBe("invalid");
  });

  // "Empty" is something the faucet says. A 503 that is an error page from the
  // platform or a proxy says nothing about its funds: it is an outage.
  it("reads a 503 without the faucet's own answer as an outage, not an empty faucet", async () => {
    noJitter();
    const spy = stubAnswers(
      () => new Response("<html>Service Unavailable</html>", { status: 503 }),
      () => json({ txHash: "0xabc" }),
    );

    const result = await requestFaucet({ url: FAUCET, address: ADDRESS });

    // It was worth another attempt, and that one went through.
    expect(result).toEqual({ txHash: "0xabc" });
    expect(spy).toHaveBeenCalledTimes(2);

    stubFetch(() => new Response("", { status: 503 }));
    const { error } = await settle(requestFaucet({ url: FAUCET, address: ADDRESS, retries: 0 }));
    expect(error?.code).toBe("unavailable");
    expect(error?.retryable).toBe(true);
    expect(error?.message).toBe("Faucet request failed (HTTP 503).");
  });

  // A 4xx is a refusal, and a refusal is never retried. A body code that says
  // "try again" cannot overrule that.
  it.each([
    [429, "faucet_busy", "rate_limited"],
    [400, "drip_failed", "invalid"],
    [403, "internal", "invalid"],
  ] as const)("never turns HTTP %i into a retryable failure (code %s)", async (status, faucetCode, code) => {
    const spy = stubFetch(() => json({ error: "refused", code: faucetCode }, status));

    const { error } = await settle(requestFaucet({ url: FAUCET, address: ADDRESS, retries: 3 }));

    expect(error?.code).toBe(code);
    expect(error?.retryable).toBe(false);
    expect(error?.faucetCode).toBe(faucetCode);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("exposes Retry-After in milliseconds, given as seconds", async () => {
    stubFetch(() =>
      json({ error: "Funded recently.", code: "address_limited" }, 429, { "retry-after": "3600" }),
    );

    const { error } = await settle(requestFaucet({ url: FAUCET, address: ADDRESS }));

    expect(error?.retryAfterMs).toBe(3_600_000);
    expect(error?.code).toBe("rate_limited");
  });

  it("exposes Retry-After in milliseconds, given as an HTTP date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
    stubFetch(() =>
      json({ error: "Rate limited." }, 429, { "retry-after": "Wed, 18 Nov 2026 10:00:30 GMT" }),
    );

    const { error } = await settle(requestFaucet({ url: FAUCET, address: ADDRESS }));

    expect(error?.retryAfterMs).toBe(30_000);
  });

  it("leaves retryAfterMs undefined when the header is missing or unreadable", async () => {
    stubFetch(() => json({ error: "Rate limited." }, 429, { "retry-after": "soon" }));

    const { error } = await settle(requestFaucet({ url: FAUCET, address: ADDRESS }));

    expect(error?.retryAfterMs).toBeUndefined();
  });

  it("never reports a date in the past as a negative wait", async () => {
    stubFetch(() =>
      json({ error: "Rate limited." }, 429, { "retry-after": "Wed, 01 Jan 2020 00:00:00 GMT" }),
    );

    const { error } = await settle(requestFaucet({ url: FAUCET, address: ADDRESS }));

    expect(error?.retryAfterMs).toBe(0);
  });
});

describe("requestFaucet retries", () => {
  const sendFailed = () => json({ error: "Could not send the drip.", code: "drip_failed" }, 502);
  const drip = () => json({ txHash: "0xabc", amount: "0.02", chainId: 43113 });

  it("tries three times by default, then reports the last failure", async () => {
    noJitter();
    const spy = stubAnswers(sendFailed);

    const { error } = await settle(requestFaucet({ url: FAUCET, address: ADDRESS }));

    expect(spy).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(FaucetError);
    expect(error?.code).toBe("unavailable");
    expect(error?.status).toBe(502);
    expect(error?.message).toBe("Could not send the drip.");
  });

  it.each([
    [0, 1],
    [1, 2],
    [4, 5],
  ])("makes retries + 1 attempts (retries: %i)", async (retries, attempts) => {
    noJitter();
    const spy = stubAnswers(sendFailed);

    await settle(requestFaucet({ url: FAUCET, address: ADDRESS, retries }));

    expect(spy).toHaveBeenCalledTimes(attempts);
  });

  it("returns the drip once a later attempt succeeds", async () => {
    noJitter();
    const spy = stubAnswers(sendFailed, new TypeError("Failed to fetch"), drip);

    const result = await requestFaucet({ url: FAUCET, address: ADDRESS, chainId: 43113 });

    expect(result).toEqual({ txHash: "0xabc", amount: "0.02", chainId: 43113 });
    expect(spy).toHaveBeenCalledTimes(3);
    // Every attempt is the same request.
    expect(sentBody(spy, 2)).toEqual(sentBody(spy, 0));
  });

  it.each([
    [429, { error: "Funded recently.", code: "address_limited" }],
    [429, { error: "Rate limit reached." }],
    [400, { error: "A valid 0x address is required." }],
    [403, { error: "Verification required.", code: "turnstile_required" }],
    [503, { error: "Faucet is empty. Please top it up." }],
    [503, { error: "Faucet is empty. Please top it up.", code: "faucet_empty" }],
  ])("never retries a refusal (HTTP %i %o)", async (status, body) => {
    noJitter();
    const spy = stubAnswers(() => json(body, status), drip);

    const { error } = await settle(requestFaucet({ url: FAUCET, address: ADDRESS, retries: 5 }));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(error?.retryable).toBe(false);
    expect(error?.message).toBe(body.error);
  });

  it("retries a busy faucet, the one 503 that is worth another try", async () => {
    noJitter();
    const spy = stubAnswers(() => json({ error: "Busy.", code: "faucet_busy" }, 503), drip);

    await expect(requestFaucet({ url: FAUCET, address: ADDRESS })).resolves.toMatchObject({
      txHash: "0xabc",
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("falls back to the default for a retry count that is not a number of attempts", async () => {
    noJitter();
    for (const retries of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const spy = stubAnswers(sendFailed);

      await settle(requestFaucet({ url: FAUCET, address: ADDRESS, retries }));

      // Never an endless loop: a retry count has to be finite.
      expect(spy).toHaveBeenCalledTimes(3);
    }
    const spy = stubAnswers(sendFailed);
    await settle(requestFaucet({ url: FAUCET, address: ADDRESS, retries: -3 }));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("requestFaucet backoff", () => {
  const sendFailed = () => json({ error: "Could not send the drip.", code: "drip_failed" }, 502);
  const busy = (retryAfter: string) => () =>
    json({ error: "Busy.", code: "faucet_busy" }, 503, { "retry-after": retryAfter });
  const drip = () => json({ txHash: "0xabc" });

  it("keeps every wait inside a window that doubles from the base delay", () => {
    const base = 800;
    for (const [failures, window] of [
      [1, 800],
      [2, 1600],
      [3, 3200],
      [4, 6400],
    ] as const) {
      expect(backoffDelay(failures, base, () => 0)).toBe(0);
      expect(backoffDelay(failures, base, () => 0.5)).toBe(window / 2);
      expect(backoffDelay(failures, base, () => 0.999_999)).toBeLessThan(window);
      expect(backoffDelay(failures, base, () => 0.999_999)).toBeGreaterThan(window - 2);
    }
  });

  it("spreads real waits over the window and never leaves it", () => {
    const waits = Array.from({ length: 2000 }, () => backoffDelay(2, 800));

    expect(Math.min(...waits)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...waits)).toBeLessThan(1600);
    // Full jitter: the waits fill the window, they do not cluster at its end.
    expect(Math.min(...waits)).toBeLessThan(160);
    expect(Math.max(...waits)).toBeGreaterThan(1440);
  });

  it("stops growing the window at thirty seconds", () => {
    expect(backoffDelay(30, 800, () => 0.999_999)).toBeLessThan(30_000);
    expect(backoffDelay(30, 800, () => 0.999_999)).toBeGreaterThan(29_990);
  });

  it("waits within the window between attempts, never past it", async () => {
    vi.useFakeTimers();
    // The top of each window: 799 of 800 ms, then 1598 of 1600 ms.
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const spy = stubAnswers(sendFailed);

    const outcome = settle(requestFaucet({ url: FAUCET, address: ADDRESS }));

    await vi.advanceTimersByTimeAsync(798);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1597);
    expect(spy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(3);

    expect((await outcome).error?.code).toBe("unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the caller's base delay", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const spy = stubAnswers(sendFailed, drip);

    const outcome = settle(requestFaucet({ url: FAUCET, address: ADDRESS, retryDelayMs: 100 }));

    await vi.advanceTimersByTimeAsync(49);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await outcome).result).toEqual({ txHash: "0xabc" });
  });

  // The rewritten faucet answers "busy" with Retry-After: 3. Trying again sooner
  // only meets the same answer and uses up the attempts.
  it("waits at least as long as a busy faucet asks before trying again", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const spy = stubAnswers(busy("3"), drip);

    const outcome = settle(requestFaucet({ url: FAUCET, address: ADDRESS }));

    await vi.advanceTimersByTimeAsync(3000);
    expect(spy).toHaveBeenCalledTimes(1);
    // The faucet's three seconds, plus the jitter (half of the 800 ms window).
    await vi.advanceTimersByTimeAsync(399);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await outcome).result).toEqual({ txHash: "0xabc" });
  });

  it("reports the failure at once when the faucet asks for a long wait", async () => {
    vi.useFakeTimers();
    const spy = stubAnswers(busy("60"), drip);

    const { error } = await settle(requestFaucet({ url: FAUCET, address: ADDRESS }));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(error?.code).toBe("unavailable");
    expect(error?.retryable).toBe(true);
    expect(error?.retryAfterMs).toBe(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("requestFaucet abort and time limit", () => {
  const sendFailed = () => json({ error: "Could not send the drip." }, 502);

  it("sends nothing when the signal is already aborted", async () => {
    const spy = stubFetch(() => json({ txHash: "0xabc" }));
    const controller = new AbortController();
    controller.abort();

    const { error } = await settle(
      requestFaucet({ url: FAUCET, address: ADDRESS, signal: controller.signal }),
    );

    expect(spy).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(FaucetError);
    expect(error?.code).toBe("network");
    expect(error?.status).toBeUndefined();
    expect(error?.message).toMatch(/aborted/);
  });

  it("sends nothing when the caller aborts in the same tick as the call", async () => {
    const spy = stubFetch(() => json({ txHash: "0xabc" }));
    const controller = new AbortController();

    const outcome = settle(
      requestFaucet({ url: FAUCET, address: ADDRESS, signal: controller.signal }),
    );
    // The call has returned its promise, but the request has not gone out yet.
    controller.abort();
    const { result, error } = await outcome;

    expect(result).toBeNull();
    expect(error?.message).toMatch(/aborted/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("stops a request in flight when the caller aborts, and does not retry it", async () => {
    const spy = stubHangingFetch();
    const controller = new AbortController();
    const reason = new Error("left the page");

    const outcome = settle(
      requestFaucet({ url: FAUCET, address: ADDRESS, signal: controller.signal, retries: 5 }),
    );
    await Promise.resolve();
    controller.abort(reason);
    const { error } = await outcome;

    expect(spy).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(FaucetError);
    expect(error?.code).toBe("network");
    expect(error?.message).toMatch(/aborted/);
    expect(error?.cause).toBe(reason);
  });

  it("stops the retry loop when the caller aborts between attempts", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const spy = stubAnswers(sendFailed);
    const controller = new AbortController();

    const outcome = settle(
      requestFaucet({ url: FAUCET, address: ADDRESS, signal: controller.signal, retries: 5 }),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(spy).toHaveBeenCalledTimes(1);

    controller.abort();
    const { error } = await outcome;

    expect(error?.message).toMatch(/aborted/);
    // The wait was cancelled with it: nothing fires later.
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("takes its listeners off the caller's signal when it is done", async () => {
    noJitter();
    stubAnswers(sendFailed, () => json({ txHash: "0xabc" }));
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener");
    const removed = vi.spyOn(controller.signal, "removeEventListener");

    await requestFaucet({ url: FAUCET, address: ADDRESS, signal: controller.signal });

    expect(added).toHaveBeenCalled();
    expect(removed).toHaveBeenCalledTimes(added.mock.calls.length);
  });

  it("gives up on an attempt after ten seconds and tries again", async () => {
    vi.useFakeTimers();
    // Waits of 400 ms, then 800 ms: half of each window.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const spy = stubHangingFetch();

    const outcome = settle(requestFaucet({ url: FAUCET, address: ADDRESS }));

    await vi.advanceTimersByTimeAsync(9_999);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    // The first request was cut off, not left running…
    expect(spy.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    // …and the next attempt follows after the backoff wait.
    await vi.advanceTimersByTimeAsync(400);
    expect(spy).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000 + 800 + 10_000);
    const { error } = await outcome;

    // Three attempts of ten seconds each, and then it is over.
    expect(spy).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(FaucetError);
    expect(error?.code).toBe("network");
    expect(error?.retryable).toBe(true);
    expect(error?.status).toBeUndefined();
    expect(error?.message).toBe("The faucet did not answer within 10 s.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the caller's time limit", async () => {
    vi.useFakeTimers();
    const spy = stubHangingFetch();

    const outcome = settle(
      requestFaucet({ url: FAUCET, address: ADDRESS, timeoutMs: 1500, retries: 0 }),
    );
    await vi.advanceTimersByTimeAsync(1500);
    const { error } = await outcome;

    expect(spy).toHaveBeenCalledTimes(1);
    expect(error?.message).toBe("The faucet did not answer within 1.5 s.");
  });

  // Headers that arrive are not an answer if the body behind them never does.
  it("counts a faucet that stalls after its headers as not answering", async () => {
    vi.useFakeTimers();
    const spy = vi.fn<Fetch>(async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          init?.signal?.addEventListener("abort", () =>
            stream.error(new DOMException("This operation was aborted", "AbortError")),
          );
        },
      });
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", spy);

    const outcome = settle(
      requestFaucet({ url: FAUCET, address: ADDRESS, timeoutMs: 1000, retries: 0 }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    const { result, error } = await outcome;

    expect(result).toBeNull();
    expect(error?.code).toBe("network");
    expect(error?.message).toMatch(/did not answer within 1 s/);
  });

  it("waits without a limit when the time limit is turned off", async () => {
    vi.useFakeTimers();
    let answer: (response: Response) => void = () => {};
    const spy = vi.fn<Fetch>(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    vi.stubGlobal("fetch", spy);

    const outcome = settle(requestFaucet({ url: FAUCET, address: ADDRESS, timeoutMs: 0 }));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    answer(json({ txHash: "0xabc" }));
    expect((await outcome).result).toEqual({ txHash: "0xabc" });
  });

  it("falls back to ten seconds for a time limit that is not a duration", async () => {
    vi.useFakeTimers();
    const spy = stubHangingFetch();

    const outcome = settle(
      requestFaucet({ url: FAUCET, address: ADDRESS, timeoutMs: Number.NaN, retries: 0 }),
    );
    await vi.advanceTimersByTimeAsync(10_000);

    expect((await outcome).error?.message).toBe("The faucet did not answer within 10 s.");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("requestFaucet captcha token", () => {
  const sendFailed = () => json({ error: "Could not send the drip.", code: "drip_failed" }, 502);
  const drip = () => json({ txHash: "0xabc" });

  it("leaves the token out of the request when none is given", async () => {
    const spy = stubFetch(drip);

    await requestFaucet({ url: FAUCET, address: ADDRESS, chainId: 43113 });

    expect(sentBody(spy)).toEqual({ address: ADDRESS, chainId: 43113 });
    expect("turnstileToken" in sentBody(spy)).toBe(false);
  });

  it("sends a token given as a string", async () => {
    const spy = stubFetch(drip);

    await requestFaucet({ url: FAUCET, address: ADDRESS, chainId: 43113, turnstileToken: "tok-1" });

    expect(sentBody(spy)).toEqual({ address: ADDRESS, chainId: 43113, turnstileToken: "tok-1" });
  });

  it("asks a token function before every attempt and sends what it returns", async () => {
    noJitter();
    const spy = stubAnswers(sendFailed, sendFailed, drip);
    let issued = 0;
    const turnstileToken = vi.fn(async () => {
      issued += 1;
      return `tok-${issued}`;
    });

    await requestFaucet({ url: FAUCET, address: ADDRESS, turnstileToken });

    // A token is single-use: each attempt carries its own.
    expect(turnstileToken).toHaveBeenCalledTimes(3);
    expect([0, 1, 2].map((i) => sentBody(spy, i).turnstileToken)).toEqual([
      "tok-1",
      "tok-2",
      "tok-3",
    ]);
  });

  it("accepts a token function that answers synchronously", async () => {
    const spy = stubFetch(drip);

    await requestFaucet({ url: FAUCET, address: ADDRESS, turnstileToken: () => "tok-sync" });

    expect(sentBody(spy).turnstileToken).toBe("tok-sync");
  });

  it("sends no token when the function has none to give", async () => {
    const spy = stubFetch(drip);

    await requestFaucet({ url: FAUCET, address: ADDRESS, turnstileToken: async () => undefined });
    await requestFaucet({ url: FAUCET, address: ADDRESS, turnstileToken: "" });

    expect("turnstileToken" in sentBody(spy, 0)).toBe(false);
    expect("turnstileToken" in sentBody(spy, 1)).toBe(false);
  });

  // The faucet verifies, and so spends, the token before it tries to send. A
  // second attempt with the same string would be turned away for the token, and
  // that refusal would replace the failure that really happened.
  it("does not retry with a token it cannot renew", async () => {
    noJitter();
    const spy = stubAnswers(sendFailed, drip);

    const { error } = await settle(
      requestFaucet({ url: FAUCET, address: ADDRESS, turnstileToken: "tok-once" }),
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(error?.code).toBe("unavailable");
    expect(error?.retryable).toBe(true);
    expect(error?.message).toBe("Could not send the drip.");
  });

  it("rejects with the token function's own error and sends nothing", async () => {
    const spy = stubFetch(drip);
    const failure = new Error("The captcha was dismissed.");

    const request = requestFaucet({
      url: FAUCET,
      address: ADDRESS,
      turnstileToken: () => {
        throw failure;
      },
    });

    await expect(request).rejects.toBe(failure);
    expect(spy).not.toHaveBeenCalled();
  });

  it("stops waiting for a token when the caller aborts", async () => {
    const spy = stubFetch(drip);
    const controller = new AbortController();

    const outcome = settle(
      requestFaucet({
        url: FAUCET,
        address: ADDRESS,
        signal: controller.signal,
        // A challenge the visitor never completes.
        turnstileToken: () => new Promise<string>(() => {}),
      }),
    );
    await Promise.resolve();
    controller.abort();
    const { error } = await outcome;

    expect(error?.message).toMatch(/aborted/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the package entry", () => {
  it("exports the faucet client, its error and the hosted endpoint", () => {
    expect(entry.requestFaucet).toBe(requestFaucet);
    expect(entry.FaucetError).toBe(FaucetError);
    expect(entry.AVAKIT_FAUCET_URL).toBe(AVAKIT_FAUCET_URL);
  });

  it("keeps the backoff helper internal", () => {
    expect("backoffDelay" in entry).toBe(false);
  });
});

describe("AVAKIT_FAUCET_URL", () => {
  it("names the drip endpoint of AvaKit's hosted Fuji faucet", () => {
    expect(AVAKIT_FAUCET_URL).toBe("https://avakit-faucet.avakit.workers.dev/fund");
  });

  // The hosted faucet is a shared courtesy. It is never a fallback: a request
  // goes to the URL the caller passed, and nowhere else.
  it("is never contacted unless the caller passes it", async () => {
    noJitter();
    const spy = stubAnswers(
      () => json({ error: "Could not send the drip." }, 502),
      () => json({ txHash: "0xabc" }),
    );

    await requestFaucet({ url: FAUCET, address: ADDRESS, chainId: 43113 });

    expect(spy.mock.calls.map(([url]) => url)).toEqual([FAUCET, FAUCET]);
  });

  it("is posted to when the caller does pass it", async () => {
    const spy = stubFetch(() => json({ txHash: "0xabc", amount: "0.02", chainId: 43113 }));

    const result = await requestFaucet({ url: AVAKIT_FAUCET_URL, address: ADDRESS });

    expect(spy.mock.calls.map(([url]) => url)).toEqual([AVAKIT_FAUCET_URL]);
    expect(result.txHash).toBe("0xabc");
  });
});
