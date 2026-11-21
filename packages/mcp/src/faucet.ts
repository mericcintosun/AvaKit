/**
 * The hosted AvaKit faucet, as the session test wallet uses it: one request for
 * one drip of Fuji test AVAX.
 *
 * The request itself is `requestFaucet` from @avakit/core, which owns the rules
 * about asking again: at most three attempts, ten seconds each, a randomised and
 * growing pause between them, and a second attempt only after a failure that may
 * be temporary (no answer, or the faucet failing on its side). A refusal (funded
 * recently, a rate or daily limit, empty or paused, a rejected request) is an
 * answer and is never repeated.
 *
 * What this file adds is what an agent gets to read. The faucet's own wording is
 * never passed on: the reason is built here from the status and the faucet's
 * refusal code, so text a server wrote does not reach a model as if this server
 * had said it.
 *
 * The faucet holds its own funding key and enforces its limits server-side
 * (services/faucet). This side never sees a key; it sends an address.
 */

import { AVAKIT_FAUCET_URL, FaucetError, requestFaucet } from "@avakit/core";
import type { Address, Hex } from "viem";

/** The shared, rate-limited Fuji faucet that @avakit/core names. */
export const DEFAULT_FAUCET_URL = AVAKIT_FAUCET_URL;
/** Points the session wallet at another faucet deployment. Set by whoever runs the server. */
export const FAUCET_URL_ENV = "AVAKIT_FAUCET_URL";
/** Requests made for one drip, the first included. */
export const FAUCET_ATTEMPTS = 3;
/** How long one request may take before it counts as failed. */
export const FAUCET_TIMEOUT_MS = 10_000;
/** The only chain the faucet is ever asked to fund. */
const FUJI_CHAIN_ID = 43113;

export type DripOutcome =
  | {
      ok: true;
      /** The faucet's funding transaction, when it reported a well-formed one. */
      txHash?: Hex;
      /** The amount it reported, in AVAX. */
      amount?: string;
    }
  | {
      ok: false;
      /** What the faucet did instead, to finish the sentence "the AvaKit faucet did not fund it: …". */
      reason: string;
      /**
       * True when a request may have reached the faucet without its answer
       * reaching us (a timeout, a dropped connection, a gateway error). The
       * drip may be on its way all the same, so the balance is worth a look.
       */
      maybeSent: boolean;
    };

interface Options {
  env?: NodeJS.ProcessEnv;
  /** Per-request timeout. A parameter so that a test does not wait ten seconds. */
  timeoutMs?: number;
  /** Base of the pause between attempts (core's default when left out). */
  retryDelayMs?: number;
}

/** The faucet endpoint, or undefined when `AVAKIT_FAUCET_URL` is set to something that is not one. */
export function faucetUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env[FAUCET_URL_ENV]?.trim();
  if (!configured) return DEFAULT_FAUCET_URL;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** A wait in words ("about 20 minutes"), or undefined for one that is not a positive duration. */
function about(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return undefined;
  const seconds = ms / 1000;
  if (seconds < 90) {
    const count = Math.ceil(seconds);
    return `about ${count} ${count === 1 ? "second" : "seconds"}`;
  }
  if (seconds < 5400) return `about ${Math.round(seconds / 60)} minutes`;
  return `about ${Math.round(seconds / 3600)} hours`;
}

function comeBack(retryAfterMs: number | undefined): string {
  const wait = about(retryAfterMs);
  return wait ? `; it can be asked again in ${wait}` : "";
}

/**
 * The faucet's own code (services/faucet/src/worker.js) in plain words, for
 * every answer that ends the request: a refusal, or a "busy" that was still the
 * answer on the last attempt. Undefined for a failure on the faucet's side,
 * which `lastAttempt` names, and for a code this server does not know. Matched
 * against a fixed list: the code is a string a server sent, and is never
 * quoted. faucet.test.ts holds the list to every code the Worker can answer.
 */
function byFaucetCode(error: FaucetError): string | undefined {
  switch (error.faucetCode) {
    case "address_limited":
      return `it already funded this wallet in the last 24 hours, and gives one drip per wallet per day${comeBack(error.retryAfterMs)}`;
    case "ip_limited":
      // The Worker's code both for a network that has had its 20 drips this
      // hour and for one with 10 failed attempts in five minutes, so the limit
      // is not named.
      return `its limit for requests from your network has been reached${comeBack(error.retryAfterMs)}`;
    case "daily_limited": {
      // The Worker's Retry-After counts down to 00:00 UTC, when the day's
      // drips start again.
      const wait = about(error.retryAfterMs);
      return `its daily limit for all callers together has been reached${wait ? `; the limit resets in ${wait}` : ""}`;
    }
    case "faucet_empty":
      return "it is out of test AVAX";
    case "faucet_paused":
      // Not empty, and not a moment's wait: off until its operator turns it
      // back on. The Worker names no time, so neither does this.
      return `it has been paused by its operator${comeBack(error.retryAfterMs) || " until further notice"}`;
    case "faucet_busy":
      return "it is busy right now; calling this tool again in a few seconds may work";
    case "turnstile_required":
    case "turnstile_failed":
    case "turnstile_unavailable":
      return "it asks for a human verification step that this server cannot complete";
    case "invalid_json":
      return "it could not read the request as JSON";
    case "invalid_address":
      return "it rejected the wallet's address as invalid";
    case "unsupported_chain":
      return `it does not fund Avalanche Fuji, chain ${FUJI_CHAIN_ID} (check ${FAUCET_URL_ENV} if it is set)`;
    case "contract_recipient":
      return "it funds wallet addresses only, and took this one for a contract";
    case "not_found":
      return `the URL it was asked at is not its /fund endpoint (check ${FAUCET_URL_ENV} if it is set)`;
    default:
      return undefined;
  }
}

/**
 * A failure the faucet reported on its own side, which is asked again, in a
 * few words. Undefined for any other code.
 */
function failedOnItsSide(error: FaucetError): string | undefined {
  switch (error.faucetCode) {
    case "drip_failed":
      return "it could not send the drip";
    case "misconfigured":
      return "it is misconfigured";
    case "internal":
      return "an internal error";
    default:
      return undefined;
  }
}

/** A refusal without a known code: what its status stands for. */
function byStatus(error: FaucetError): string {
  if (error.code === "rate_limited") {
    return `it is rate limiting requests${comeBack(error.retryAfterMs)}`;
  }
  if (error.code === "empty") return "it is out of test AVAX";
  // A page instead of a faucet's JSON: what a wrong URL gets from a web site.
  if (error.status !== undefined && error.status < 400) {
    return `it answered with a web page, not a faucet's answer (check ${FAUCET_URL_ENV} if it is set)`;
  }
  if (error.status === 400) return "it rejected the request as invalid (HTTP 400)";
  return `it answered HTTP ${error.status}`;
}

/** How an attempt that got no usable answer went, in a few words. */
function lastAttempt(error: FaucetError, timeoutMs: number): string {
  if (error.code !== "network") {
    const said = failedOnItsSide(error);
    return said ? `HTTP ${error.status}, ${said}` : `HTTP ${error.status}`;
  }
  const cause = error.cause as { name?: unknown; cause?: { code?: unknown } } | null | undefined;
  if (cause?.name === "TimeoutError" || cause?.name === "AbortError") {
    return `no answer within ${timeoutMs / 1000} seconds`;
  }
  // Node reports the cause of "fetch failed" as a code: ENOTFOUND, ECONNREFUSED…
  const code = cause?.cause?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(code)
    ? `network error ${code}`
    : "network error";
}

/**
 * Ask the faucet to fund `address` on Fuji.
 *
 * Never throws: a refusal and a failure both come back as `{ ok: false }` with
 * a reason in plain words.
 */
export async function requestDrip(address: Address, options: Options = {}): Promise<DripOutcome> {
  const { env = process.env, timeoutMs = FAUCET_TIMEOUT_MS, retryDelayMs } = options;
  const url = faucetUrl(env);
  if (!url) {
    return { ok: false, reason: `${FAUCET_URL_ENV} is not an http(s) URL`, maybeSent: false };
  }

  let attempts = 0;
  try {
    const { txHash, amount } = await requestFaucet({
      url,
      address,
      chainId: FUJI_CHAIN_ID,
      retries: FAUCET_ATTEMPTS - 1,
      timeoutMs,
      retryDelayMs,
      // Asked before every attempt, which is used here to count them and for
      // nothing else: this server has no captcha token to send, ever.
      turnstileToken: () => {
        attempts += 1;
        return undefined;
      },
    });
    // A success is taken at its status; a field that does not look like what
    // the faucet sends is dropped rather than repeated.
    return {
      ok: true,
      ...(typeof txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(txHash) ? { txHash } : {}),
      ...(typeof amount === "string" && /^\d{1,9}(\.\d{1,18})?$/.test(amount) ? { amount } : {}),
    };
  } catch (error) {
    if (!(error instanceof FaucetError)) {
      return { ok: false, reason: "the request to it failed unexpectedly", maybeSent: true };
    }
    // Every attempt before the last one ended without a usable answer (that is
    // what gets a request repeated), and so may have been served unheard.
    // A first and only answer in the faucet's own words is a plain no.
    const known = byFaucetCode(error);
    const maybeSent = attempts > 1 || (error.retryable && known === undefined);
    if (known) return { ok: false, reason: known, maybeSent };
    if (!error.retryable) return { ok: false, reason: byStatus(error), maybeSent };
    const last = lastAttempt(error, timeoutMs);
    return {
      ok: false,
      reason:
        attempts > 1
          ? `it did not answer properly in ${attempts} attempts (the last one: ${last})`
          : `it did not answer properly (${last})${comeBack(error.retryAfterMs)}`,
      maybeSent,
    };
  }
}
