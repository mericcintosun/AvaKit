import type { Address, Hex } from "viem";
import { FaucetError, type FaucetErrorCode } from "./errors.js";

/**
 * Client for an AvaKit-hosted testnet faucet. The faucet holds the funding key
 * and enforces rate limits server-side, so a new user's first transaction is
 * funded with no wallet setup and no manual faucet visit. AvaKit code never
 * touches a private key here — it just calls the drip endpoint.
 */

/**
 * AvaKit's shared, rate-limited Fuji faucet: one small drip per address per
 * day, there so that a first run works with no faucet of your own. It is a
 * shared courtesy, not infrastructure: it can be empty or busy, and anything
 * serious should run its own faucet (see `services/faucet` in the AvaKit
 * repository) and pass that URL instead.
 *
 * Nothing in AvaKit uses this by default. Pass it explicitly, as
 * `requestFaucet({ url: AVAKIT_FAUCET_URL, … })` or as `faucetUrl` on
 * `<AvaKitProvider>`.
 */
export const AVAKIT_FAUCET_URL = "https://avakit-faucet.avakit.workers.dev/fund";

/** Where a captcha token comes from: the token itself, or a function asked before every attempt. */
export type FaucetTokenSource = string | (() => string | undefined | Promise<string | undefined>);

export interface FaucetRequestOptions {
  /** Faucet endpoint that drips testnet AVAX (POST `{ address, chainId, turnstileToken? }`). */
  url: string;
  /** Address to fund. */
  address: Address;
  /** Target chain id (defaults to the faucet's own chain). */
  chainId?: number;
  /**
   * Abort signal. Aborting stops the request and any retry still to come, and
   * rejects with a `FaucetError` whose code is `"network"`.
   */
  signal?: AbortSignal;
  /**
   * Cloudflare Turnstile token, for a faucet that asks for one. Sent as
   * `turnstileToken` in the request body; left out when not given.
   *
   * A token is single-use, so pass a function when retries are on: it is called
   * before every attempt and may return a fresh token, or `undefined` to send
   * none. A plain string is sent once: a request that fails with it is not
   * retried, because the faucet would only reject the spent token.
   */
  turnstileToken?: FaucetTokenSource;
  /**
   * How many times to try again after a failure that may be temporary (a
   * `FaucetError` with `retryable: true`: the faucet failed on its side, or did
   * not answer). Default 2, so at most three attempts. A refusal (rate limit,
   * empty faucet, bad request) is never retried. `0` turns retries off.
   */
  retries?: number;
  /**
   * Base of the wait between attempts, in milliseconds. Default 800. The wait
   * is random between zero and a window that starts at this value and doubles
   * after every failure (exponential backoff with full jitter), up to 30
   * seconds. When the faucet names a wait itself (`Retry-After`) of up to five
   * seconds, that long is waited first; a longer one ends the retries at once.
   */
  retryDelayMs?: number;
  /**
   * How long one attempt may take before it counts as failed, in milliseconds.
   * Default 10 000. `0` turns the limit off.
   */
  timeoutMs?: number;
}

export interface FaucetResult {
  /** The drip transaction hash, if the faucet broadcast one. */
  txHash?: Hex;
  /** Amount dripped (human-readable), if reported. */
  amount?: string;
  /** Chain the drip was sent on, if reported. */
  chainId?: number;
  /** Optional status message (e.g. "already funded"). */
  message?: string;
}

const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 800;
const DEFAULT_TIMEOUT_MS = 10_000;
/** The backoff window stops doubling here. */
const MAX_BACKOFF_MS = 30_000;
/** The longest `Retry-After` worth sitting out. A faucet that asks for more is reported at once. */
const MAX_RETRY_AFTER_MS = 5_000;

/**
 * What the refusal codes of the AvaKit faucet Worker (`services/faucet`) mean
 * here. Its newer generation answers `{ error, code }`; the HTTP status alone
 * cannot tell a busy faucet (try again) from an empty one (do not), both 503.
 * An answer without a known code falls back to its status.
 */
const FAUCET_CODES: ReadonlyMap<string, FaucetErrorCode> = new Map<string, FaucetErrorCode>([
  ["invalid_json", "invalid"],
  ["invalid_address", "invalid"],
  ["unsupported_chain", "invalid"],
  ["turnstile_required", "invalid"],
  ["turnstile_failed", "invalid"],
  ["not_found", "invalid"],
  ["contract_recipient", "invalid"],
  ["address_limited", "rate_limited"],
  ["ip_limited", "rate_limited"],
  ["faucet_empty", "empty"],
  ["faucet_busy", "unavailable"],
  ["turnstile_unavailable", "unavailable"],
  ["drip_failed", "unavailable"],
  ["misconfigured", "unavailable"],
  ["internal", "unavailable"],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for a body that is markup (an HTML page, an XML error document). Judged
 * by how it starts, not by its declared type: plenty of servers label a plain
 * "OK" as text/html.
 */
function isMarkup(text: string): boolean {
  return text.trimStart().startsWith("<");
}

/** `Retry-After` in milliseconds: the header is either a number of seconds or an HTTP date. */
function parseRetryAfter(header: string | null): number | undefined {
  const value = header?.trim();
  if (!value) return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** The error for an answer the faucet gave with a non-2xx status. */
function refusal(res: Response, body: unknown): FaucetError {
  const fields = isRecord(body) ? body : {};
  const faucetCode = typeof fields.code === "string" && fields.code ? fields.code : undefined;
  const message =
    typeof fields.error === "string" && fields.error
      ? fields.error
      : `Faucet request failed (HTTP ${res.status}).`;
  // Undefined for an unknown code, which leaves the decision to the status.
  let code = faucetCode === undefined ? undefined : FAUCET_CODES.get(faucetCode);
  // A 4xx says the request was refused, and a refusal is never retried. No
  // code in the body may turn it into a failure worth another attempt.
  if (code === "unavailable" && res.status >= 400 && res.status < 500) {
    code = undefined;
  }
  // By status alone a 503 means "empty", because that is what the faucet
  // answers when it has run dry. A 503 without the faucet's own JSON answer
  // was not written by the faucet, though: it is the error page of the platform
  // or a proxy in front of it. That is an outage, and worth another attempt.
  if (code === undefined && res.status === 503 && typeof fields.error !== "string") {
    code = "unavailable";
  }
  return new FaucetError(message, res.status, {
    code,
    faucetCode,
    retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
  });
}

/** What a request rejects with once its caller has aborted it. */
function abortError(signal: AbortSignal): FaucetError {
  return new FaucetError("Faucet request aborted before the faucet answered.", undefined, {
    code: "network",
    cause: signal.reason,
  });
}

/** Resolves with `promise`, or rejects as soon as `signal` aborts, whichever is first. */
function orAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    // Settling twice is a no-op, so whichever comes second is simply dropped.
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return orAborted(waited, signal).finally(() => clearTimeout(timer));
}

/**
 * How long to wait after the `failures`-th failure in a row: a random time from
 * zero up to (not including) a window of `baseMs`, doubled for every failure
 * before this one and capped. Spreading the wait over the whole window ("full
 * jitter") keeps a room full of clients that failed together from retrying
 * together. (Internal: not part of the package's public exports.)
 */
export function backoffDelay(
  failures: number,
  baseMs: number,
  random: () => number = Math.random,
): number {
  const window = Math.min(baseMs * 2 ** Math.max(0, failures - 1), MAX_BACKOFF_MS);
  return Math.floor(random() * window);
}

/**
 * The wait before the next attempt, or null when there should be none: the
 * faucet asked for a longer pause than a caller should be kept waiting for.
 */
function retryWait(error: FaucetError, failures: number, baseMs: number): number | null {
  const jitter = backoffDelay(failures, baseMs);
  if (error.retryAfterMs === undefined) return jitter;
  if (error.retryAfterMs > MAX_RETRY_AFTER_MS) return null;
  // The faucet's own number is the floor; the jitter on top still spreads out
  // everyone who was told the same thing at the same moment.
  return error.retryAfterMs + jitter;
}

/** The token to send with the next attempt, if any. An empty one counts as none. */
async function resolveToken(
  source: FaucetTokenSource | undefined,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (typeof source !== "function") return source || undefined;
  // Called from inside a promise, so that a function that throws rejects instead.
  // The wait is not timed (a challenge may need the visitor), only abortable.
  const token = await orAborted(Promise.resolve().then(source), signal);
  return typeof token === "string" && token ? token : undefined;
}

/** A whole, non-negative count, or the default for anything else. */
function countOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

/** A non-negative number of milliseconds, or the default for anything else. */
function millisecondsOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && value >= 0 ? value : fallback;
}

/** One POST to the faucet. Resolves with its answer, or rejects with a `FaucetError`. */
async function attempt(
  options: FaucetRequestOptions,
  turnstileToken: string | undefined,
  timeoutMs: number,
): Promise<FaucetResult> {
  const { signal } = options;
  // An abort that has already happened fires no event, so ask.
  if (signal?.aborted) throw abortError(signal);
  // One controller per attempt, aborted by the caller's signal or by the time
  // limit. (`AbortSignal.any` would say this in one line, but is missing from
  // browsers that are still in use.)
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  // 0 and Infinity both mean "no limit".
  const timer =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;

  try {
    let res: Response;
    let text: string;
    try {
      res = await fetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: options.address,
          chainId: options.chainId,
          turnstileToken,
        }),
        signal: controller.signal,
      });
      // Read the body inside the same limits: a faucet that sends its headers
      // and then stalls has not answered.
      text = await res.text();
    } catch (cause) {
      if (signal?.aborted) throw abortError(signal);
      if (timedOut) {
        throw new FaucetError(
          `The faucet did not answer within ${timeoutMs / 1000} s.`,
          undefined,
          { code: "network", cause },
        );
      }
      throw new FaucetError(
        `Faucet request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        undefined,
        { code: "network", cause },
      );
    }

    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      // Not JSON (a proxy's HTML error page, say): the status still speaks.
    }
    if (!res.ok) throw refusal(res, body);
    if (isRecord(body)) return body as FaucetResult;
    // A web page is not a faucet's answer, whatever its status. It is what a
    // wrong URL gets from a site that serves its app for every path, and
    // reading it as "funded" would report a drip that nobody sent.
    if (body === undefined && isMarkup(text)) {
      throw new FaucetError(
        `The faucet URL answered with a web page, not a faucet's JSON (HTTP ${res.status}). ` +
          "Check that it points at the faucet's endpoint.",
        res.status,
        { code: "invalid" },
      );
    }
    // A faucet that reports nothing more than success.
    return {};
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Ask the faucet to fund `address`.
 *
 * Rejects with a `FaucetError` when the faucet refuses or cannot be reached. Its
 * `code` says which (`"rate_limited"`, `"empty"`, `"invalid"`, `"unavailable"`,
 * `"network"`), `retryable` whether trying again may help, and `retryAfterMs`
 * how long the faucet asked to wait, when it said.
 *
 * A failure that may be temporary is retried here, `retries` times (default 2)
 * with exponential backoff and jitter, so a caller gets either a drip or a
 * failure worth showing. Every attempt is limited to `timeoutMs` (default ten
 * seconds), which keeps a faucet that hangs from hanging the caller.
 *
 * A retry repeats a request whose outcome may be unknown. With a faucet that
 * limits drips per address, as AvaKit's does, that cannot fund the address
 * twice: if the first answer was merely lost on the way back, the repeat is
 * refused as `"rate_limited"` even though funds were sent.
 */
export async function requestFaucet(options: FaucetRequestOptions): Promise<FaucetResult> {
  const { signal, turnstileToken: tokenSource } = options;
  const retries = countOr(options.retries, DEFAULT_RETRIES);
  const retryDelayMs = millisecondsOr(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS);
  const timeoutMs = millisecondsOr(options.timeoutMs, DEFAULT_TIMEOUT_MS);

  let failures = 0;
  for (;;) {
    if (signal?.aborted) throw abortError(signal);
    const turnstileToken = await resolveToken(tokenSource, signal);
    try {
      return await attempt(options, turnstileToken, timeoutMs);
    } catch (error) {
      failures += 1;
      if (!(error instanceof FaucetError) || !error.retryable) throw error;
      if (failures > retries || signal?.aborted) throw error;
      // A captcha token is spent by the attempt that carried it. Without a
      // function to ask for another, a second attempt could only be rejected
      // for the token, which would bury the failure that actually happened.
      if (turnstileToken !== undefined && typeof tokenSource !== "function") throw error;
      const wait = retryWait(error, failures, retryDelayMs);
      if (wait === null) throw error;
      await sleep(wait, signal);
    }
  }
}
