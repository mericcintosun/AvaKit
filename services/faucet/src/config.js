import { formatEther, parseEther } from "viem";
import { FaucetConfigError } from "./sender.js";

/**
 * The faucet's settings, read from the Worker's environment. Every reader
 * throws FaucetConfigError for a value it cannot use, so a typo in
 * wrangler.toml shows up as `500 misconfigured` (on /health first) instead of
 * a faucet that quietly runs with a limit nobody chose. No message here ever
 * repeats the value it refused: some of these may one day be set as secrets.
 */

/** Drips per UTC day for callers without a verified Turnstile token, if unset. */
export const DEFAULT_DAILY_DRIPS = 50;
/** Drips per UTC day for callers whose Turnstile token was verified, if unset. */
export const DEFAULT_DAILY_DRIPS_VERIFIED = 100;
/** The balance, in AVAX, under which /health reports `low: true`, if unset. */
export const DEFAULT_LOW_BALANCE_AVAX = "1";

/** The two budgets a drip can be drawn from. */
export const UNVERIFIED = "unverified";
export const VERIFIED = "verified";

/**
 * What one drip is: `amount` as configured (AVAX, as text) and `value` in wei.
 * wrangler.toml sets the amount; this default only applies without it.
 */
export function dripAmount(env) {
  const amount = text(env.FAUCET_DRIP_AVAX) || "0.05";
  const value = avax(amount);
  if (value === null || value <= 0n) {
    throw new FaucetConfigError("FAUCET_DRIP_AVAX is not a valid amount.");
  }
  return { amount, value };
}

/**
 * The most drips sent in one UTC day, per budget. A request draws on
 * `verified` only when it carried a Turnstile token that Cloudflare vouched
 * for; every other request, whatever its origin, draws on `unverified`. The
 * two are kept apart so that a script spending the open budget cannot also
 * spend the one people on avakit.dev draw on. 0 closes a budget.
 */
export function dailyBudgets(env) {
  return {
    [UNVERIFIED]: wholeNumber(env.FAUCET_DAILY_DRIPS, DEFAULT_DAILY_DRIPS, "FAUCET_DAILY_DRIPS"),
    [VERIFIED]: wholeNumber(
      env.FAUCET_DAILY_DRIPS_VERIFIED,
      DEFAULT_DAILY_DRIPS_VERIFIED,
      "FAUCET_DAILY_DRIPS_VERIFIED",
    ),
  };
}

/**
 * The kill switch. Any value other than an empty one, "0", "false", "no" or
 * "off" pauses the faucet: a switch that is meant to stop a drain should not
 * fail open on a typo.
 */
export function isPaused(env) {
  const value = text(env.FAUCET_PAUSED).toLowerCase();
  return !["", "0", "false", "no", "off"].includes(value);
}

/** The balance under which /health says `low`: `{ text, value }`, AVAX and wei. */
export function lowBalance(env) {
  const amount = text(env.FAUCET_LOW_BALANCE_AVAX) || DEFAULT_LOW_BALANCE_AVAX;
  const value = avax(amount);
  if (value === null || value < 0n) {
    throw new FaucetConfigError("FAUCET_LOW_BALANCE_AVAX is not a valid amount.");
  }
  return { text: formatEther(value), value };
}

/**
 * The origins that must send a Turnstile token once TURNSTILE_SECRET is set,
 * or null when every caller must (the setting is empty). The value is a list
 * of origins, such as "https://avakit.dev", separated by commas or spaces.
 */
export function turnstileOrigins(env) {
  const raw = text(env.TURNSTILE_ORIGINS);
  if (!raw) return null;

  const origins = new Set();
  for (const entry of raw.split(/[\s,]+/).filter(Boolean)) {
    const origin = originOf(entry);
    // Only a bare origin: a path, a query or a missing scheme would never be
    // what a browser sends, and so would never match anything.
    if (origin === null || origin !== entry.toLowerCase().replace(/\/$/, "")) {
      throw new FaucetConfigError("TURNSTILE_ORIGINS is not a list of origins.");
    }
    origins.add(origin);
  }
  return origins;
}

/**
 * Whether a request whose `Origin` header is `origin` has to carry a
 * Turnstile token. Never true while TURNSTILE_SECRET is unset.
 *
 * This is not what stops a script: a script sends whatever Origin it likes, or
 * none, and is then simply not asked for a token. What it buys is that the
 * listed pages can only ever draw on the verified budget, which no script can
 * reach without solving a challenge. PROTECTION.md has the whole argument.
 */
export function tokenRequired(env, origin) {
  if (!env.TURNSTILE_SECRET) return false;
  const origins = turnstileOrigins(env);
  if (origins === null) return true;
  return origins.has(originOf(origin));
}

/**
 * The commit the running Worker was deployed from: GIT_SHA, which the deploy
 * workflow sets with `wrangler deploy --var GIT_SHA:<commit>`, or "dev" for a
 * Worker deployed any other way. Only ever a commit hash, whatever the
 * variable holds, so /health cannot be made to repeat another value.
 */
export function deployedVersion(env) {
  const sha = text(env.GIT_SHA).toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha : "dev";
}

/** A setting as trimmed text: a var may also be a number in wrangler.toml. */
function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

/** `value` AVAX in wei, or null when it is not an amount. */
function avax(value) {
  try {
    return parseEther(value);
  } catch {
    return null;
  }
}

function wholeNumber(value, fallback, name) {
  const raw = text(value);
  if (raw === "") return fallback;
  if (!/^\d{1,9}$/.test(raw)) throw new FaucetConfigError(`${name} is not a whole number.`);
  return Number(raw);
}

/** The origin of a URL, lower-cased, or null for anything that is not an http(s) URL. */
function originOf(value) {
  if (typeof value !== "string" || value === "") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
