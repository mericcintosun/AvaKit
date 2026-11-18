/**
 * The hosted AvaKit faucet, as the session test wallet uses it: one request for
 * one drip of Fuji test AVAX, with rules about when asking again makes sense.
 *
 * The faucet holds its own funding key and enforces its limits server-side
 * (services/faucet). This side never sees a key; it sends an address and reads
 * a status code.
 */

import type { Address, Hex } from "viem";
import { clock } from "./time.js";

export const DEFAULT_FAUCET_URL = "https://avakit-faucet.avakit.workers.dev/fund";
/** Points the session wallet at another faucet deployment. Set by whoever runs the server. */
export const FAUCET_URL_ENV = "AVAKIT_FAUCET_URL";
/** Requests made for one drip, the first included. */
export const FAUCET_ATTEMPTS = 3;
/** How long one request may take before it counts as failed. */
export const FAUCET_TIMEOUT_MS = 10_000;
/** The first retry waits about this long, the second about twice that. */
export const FAUCET_BACKOFF_MS = 1_000;
/** The faucet's answers are a few hundred bytes. Anything far larger is not read. */
const MAX_BODY_BYTES = 64 * 1024;
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

/** A response body as JSON, read up to a limit. Anything else is an empty object. */
async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const reader = response.body?.getReader();
    if (!reader) return {};
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return {};
      }
      chunks.push(value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function comeBack(retryAfter: string | null): string {
  const seconds = Number(retryAfter);
  if (!retryAfter || !Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 90) return `; it can be asked again in about ${Math.ceil(seconds)} seconds`;
  if (seconds < 5400) return `; it can be asked again in about ${Math.round(seconds / 60)} minutes`;
  return `; it can be asked again in about ${Math.round(seconds / 3600)} hours`;
}

/**
 * A refusal in plain words. Built from the status and the faucet's own `code`
 * (services/faucet/src/worker.js), never from free text in the response: what a
 * server says is not passed on to an agent as if this server had said it.
 */
function refusal(status: number, code: unknown, retryAfter: string | null): string {
  switch (code) {
    case "address_limited":
      return `it already funded this wallet in the last 24 hours, and gives one drip per wallet per day${comeBack(retryAfter)}`;
    case "ip_limited":
      return `its hourly limit for your network has been reached${comeBack(retryAfter)}`;
    case "faucet_empty":
      return "it is out of test AVAX";
    case "faucet_busy":
      return "it is busy right now; calling this tool again in a few seconds may work";
    case "turnstile_required":
    case "turnstile_failed":
    case "turnstile_unavailable":
      return "it asks for a human verification step that this server cannot complete";
  }
  if (status === 429) return `it is rate limiting requests${comeBack(retryAfter)}`;
  if (status === 503) return "it is unavailable right now (HTTP 503)";
  if (status === 400) return "it rejected the request as invalid (HTTP 400)";
  return `it answered HTTP ${status}`;
}

function failure(error: unknown, timeoutMs: number): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return `no answer within ${timeoutMs / 1000} seconds`;
  }
  // Node reports the cause of "fetch failed" as a code: ENOTFOUND, ECONNREFUSED…
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === "string" ? `network error ${code}` : "network error";
}

/** Exponential backoff with jitter: about 1 s before the second request, about 2 s before the third. */
function backoff(retry: number): number {
  return Math.round(FAUCET_BACKOFF_MS * 2 ** (retry - 1) * (0.5 + Math.random() / 2));
}

/**
 * Ask the faucet to fund `address` on Fuji.
 *
 * Asking again is only worth it when the answer might be different: after a
 * network error, or a 5xx that is not 503. A 429 (already funded, rate limit),
 * a 503 (empty, busy) and a 4xx are answers, and repeating the question three
 * times would only spend the caller's rate-limit allowance.
 */
export async function requestDrip(address: Address, options: Options = {}): Promise<DripOutcome> {
  const { env = process.env, timeoutMs = FAUCET_TIMEOUT_MS } = options;
  const url = faucetUrl(env);
  if (!url) {
    return { ok: false, reason: `${FAUCET_URL_ENV} is not an http(s) URL`, maybeSent: false };
  }

  let maybeSent = false;
  let last = "";
  for (let attempt = 1; attempt <= FAUCET_ATTEMPTS; attempt++) {
    if (attempt > 1) await clock.sleep(backoff(attempt - 1));

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, chainId: FUJI_CHAIN_ID }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      maybeSent = true;
      last = failure(error, timeoutMs);
      continue;
    }

    const body = await readJson(response);
    if (response.ok) {
      const { txHash, amount } = body;
      return {
        ok: true,
        ...(typeof txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(txHash)
          ? { txHash: txHash as Hex }
          : {}),
        ...(typeof amount === "string" && /^\d{1,9}(\.\d{1,18})?$/.test(amount) ? { amount } : {}),
      };
    }
    if (response.status >= 500 && response.status !== 503) {
      // A gateway can answer 502 or 504 for a request the faucet went on to serve.
      maybeSent = true;
      last = `HTTP ${response.status}`;
      continue;
    }
    return {
      ok: false,
      reason: refusal(response.status, body.code, response.headers.get("retry-after")),
      maybeSent,
    };
  }
  return {
    ok: false,
    reason: `it did not answer properly in ${FAUCET_ATTEMPTS} attempts (the last one: ${last})`,
    maybeSent,
  };
}
