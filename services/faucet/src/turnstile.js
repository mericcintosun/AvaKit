const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare caps a token at 2048 characters; anything longer is not one. */
const MAX_TOKEN_LENGTH = 2048;

/** How long to wait for Cloudflare before treating verification as down. */
const TIMEOUT_MS = 5000;

/**
 * Checks a Cloudflare Turnstile token server-side.
 *
 * Fails closed: if Cloudflare cannot be reached, or rejects our own secret, the
 * answer is "unavailable" and the caller refuses the drip. A captcha that lets
 * everyone through whenever it is down protects nothing.
 *
 * @returns {Promise<"ok" | "failed" | "unavailable">}
 *   "failed" is the visitor's token (missing, expired, already used, forged);
 *   "unavailable" is our side and worth retrying.
 */
export async function verifyTurnstile({ secret, token, ip, url = SITEVERIFY_URL }) {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return "failed";
  }

  let outcome;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return "unavailable";
    outcome = await response.json();
  } catch {
    return "unavailable";
  }
  if (outcome?.success === true) return "ok";

  const codes = Array.isArray(outcome?.["error-codes"]) ? outcome["error-codes"].map(String) : [];
  // Never the token or the secret — only Cloudflare's own error codes.
  console.warn(JSON.stringify({ message: "turnstile rejected a token", codes }));

  const ours = codes.some((code) => code === "internal-error" || code.endsWith("-input-secret"));
  return ours ? "unavailable" : "failed";
}
