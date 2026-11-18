import { DurableObject } from "cloudflare:workers";
import { isAddress, parseEther } from "viem";
import { clientKey } from "./ip.js";
import { DripLimits, IP_WINDOW_MS } from "./limits.js";
import {
  CHAINS,
  connect,
  DEFAULT_CHAIN_ID,
  DripSender,
  describeError,
  FaucetConfigError,
  FaucetEmptyError,
} from "./sender.js";
import { verifyTurnstile } from "./turnstile.js";

/**
 * AvaKit faucet — a Cloudflare Worker that drips testnet AVAX so a new user's
 * first transaction is funded with no wallet setup. It holds the funding key as a
 * Worker secret, so AvaKit client code never touches a private key.
 *
 *   POST /fund   { address, chainId?, turnstileToken? }  → { txHash, amount, chainId }
 *   GET  /health                        → { ok, address, chainId, balance, turnstile }
 *
 * Point a dapp at it: <AvaKitProvider faucetUrl="https://<worker>/fund">
 *
 * The Worker itself is stateless: it validates the request, checks a Turnstile
 * token if one is required, and hands the drip to the `Faucet` Durable Object.
 * That object is the one place that both counts drips and signs them, which is
 * what makes the rate limits exact and keeps two drips off the same nonce.
 *
 * ⚠️ Testnet only. CHAINS is an allowlist, so this can never drip real funds.
 *    Set TURNSTILE_SECRET before advertising it widely — the rate limits bound
 *    what one network can take; a captcha is what stops a thousand of them.
 */

/**
 * Every way a request is turned down: code → [status, message]. The text is
 * fixed on purpose. An upstream error (viem prints the RPC URL and the request
 * body in its messages) goes to the Worker log and never to the caller.
 */
const REFUSALS = {
  invalid_json: [400, "Invalid JSON body."],
  invalid_address: [400, "A valid 0x address is required."],
  unsupported_chain: [400, "Unsupported or non-testnet chainId."],
  turnstile_required: [403, "Verification required."],
  turnstile_failed: [403, "Verification failed. Try again."],
  turnstile_unavailable: [503, "Verification is unavailable. Try again shortly."],
  not_found: [404, "Not found."],
  address_limited: [429, "This address was funded recently. Try again later."],
  ip_limited: [429, "Rate limit reached. Try again later."],
  faucet_busy: [503, "The faucet is busy. Try again in a few seconds."],
  faucet_empty: [503, "Faucet is empty. Please top it up."],
  drip_failed: [502, "The faucet could not send the drip. Try again shortly."],
  misconfigured: [500, "Faucet is misconfigured."],
  internal: [500, "Faucet error. Try again shortly."],
};

/** Drips one object will prepare or send at once before asking callers to come back. */
const MAX_ACTIVE_DRIPS = 64;
const BUSY_RETRY_S = 3;

function cors(env) {
  return {
    "access-control-allow-origin": env.FAUCET_CORS_ORIGIN || "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-expose-headers": "retry-after",
    "access-control-max-age": "86400",
  };
}

function json(body, status, env, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors(env), ...headers },
  });
}

/** `{ error, code }` for a refusal, with `Retry-After` when we know when to come back. */
function refuse({ code, message, retryAfter }, env) {
  const [status, text] = REFUSALS[code] ?? REFUSALS.internal;
  return json(
    { error: message ?? text, code },
    status,
    env,
    retryAfter ? { "retry-after": String(retryAfter) } : undefined,
  );
}

/**
 * Preflight. This MUST be a null body: constructing a Response with a body and a
 * 204 throws, which would take the whole Worker down and leave the browser with
 * no CORS headers at all — i.e. every /fund call fails before it is even sent.
 */
function preflight(env) {
  return new Response(null, { status: 204, headers: cors(env) });
}

const KEY_MISSING = { code: "misconfigured", message: "Faucet key not configured." };

async function health(env) {
  if (!env.AVAKIT_FAUCET_KEY) return refuse(KEY_MISSING, env);

  const { account, client } = connect(DEFAULT_CHAIN_ID, env);
  const balance = await client.getBalance({ address: account.address }).catch(() => null);
  return json(
    {
      ok: true,
      address: account.address,
      chainId: DEFAULT_CHAIN_ID,
      balance: balance != null ? balance.toString() : null,
      // Whether POST /fund expects a `turnstileToken`.
      turnstile: Boolean(env.TURNSTILE_SECRET),
    },
    200,
    env,
  );
}

async function fund(request, env, ctx) {
  if (!env.AVAKIT_FAUCET_KEY) return refuse(KEY_MISSING, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return refuse({ code: "invalid_json" }, env);
  }
  if (!body || typeof body.address !== "string" || !isAddress(body.address)) {
    return refuse({ code: "invalid_address" }, env);
  }

  const chainId = Number(body.chainId ?? DEFAULT_CHAIN_ID);
  if (!Object.hasOwn(CHAINS, chainId)) {
    return refuse(
      { code: "unsupported_chain", message: `Unsupported or non-testnet chainId ${chainId}.` },
      env,
    );
  }

  const ip = request.headers.get("cf-connecting-ip");

  // Opt-in: enforced only once the operator has set the secret. It runs here,
  // at the edge, so a bot never gets as far as the Durable Object.
  if (env.TURNSTILE_SECRET) {
    if (!body.turnstileToken) return refuse({ code: "turnstile_required" }, env);
    const verdict = await verifyTurnstile({
      secret: env.TURNSTILE_SECRET,
      token: body.turnstileToken,
      ip,
      // Unset in production: it only lets a test stand in for Cloudflare.
      url: env.TURNSTILE_VERIFY_URL || undefined,
    });
    if (verdict !== "ok") return refuse({ code: `turnstile_${verdict}` }, env);
  }

  // One object per chain: it owns that chain's limits and the account's nonce.
  const faucet = env.FAUCET.get(env.FAUCET.idFromName(String(chainId)));
  const drip = (async () => faucet.drip({ chainId, to: body.address, client: clientKey(ip) }))();
  // If the caller hangs up, stay with the drip until the object has answered.
  ctx.waitUntil(drip.catch(() => {}));

  const result = await drip;
  if (!result.ok) return refuse(result, env);
  return json({ txHash: result.txHash, amount: result.amount, chainId: result.chainId }, 200, env);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return preflight(env);

    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") return await health(env);
      if (request.method === "POST" && url.pathname === "/fund") {
        return await fund(request, env, ctx);
      }
      return refuse({ code: "not_found" }, env);
    } catch (e) {
      if (e instanceof FaucetConfigError) {
        return refuse({ code: "misconfigured", message: e.message }, env);
      }
      console.error(
        JSON.stringify({ message: "unhandled error", ...describeError(e, env.FAUCET_FUJI_RPC) }),
      );
      return refuse({ code: "internal" }, env);
    }
  },
};

// ── The faucet account ──────────────────────────────────────────────────────

/**
 * Counts drips and sends them, for one chain.
 *
 * Both jobs need a single place that sees every request in order — the limits
 * so that a burst cannot read a counter before anyone has written it, the
 * sender so that two drips never sign the same nonce. A Durable Object is that
 * place; KV, which the limits used to live in, is not.
 */
export class Faucet extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.limits = new DripLimits(ctx.storage.sql);
    this.active = 0;
    this.connection = null;
  }

  /**
   * Fund `to`, unless a limit says no. Never throws for an expected failure:
   * the caller gets `{ ok: false, code }` and maps it to a response.
   */
  async drip({ chainId, to, client }) {
    const address = to.toLowerCase();

    // Cheap, read-only refusals first, so an over-limit or flooding caller costs
    // neither an RPC call nor a storage write.
    const refused = this.limits.refusal({ address, client });
    if (refused) return { ok: false, ...refused };
    if (this.active >= MAX_ACTIVE_DRIPS) {
      return { ok: false, code: "faucet_busy", retryAfter: BUSY_RETRY_S };
    }

    this.active += 1;
    let reservation;
    try {
      const { sender, amount, value } = this.#setup(chainId);
      const request = await sender.prepare({ to, value });

      // Only now, with a transaction ready to send, is a slot taken — an empty
      // faucet or an unreachable RPC is turned away above without writing a
      // row. Other requests ran during that await, so reserve() checks again.
      reservation = this.limits.reserve({ address, client });
      if (reservation.refused) return { ok: false, ...reservation.refused };
      await this.#scheduleCleanup();

      const txHash = await sender.broadcast(request);
      this.limits.settle(reservation.id);
      return { ok: true, txHash, amount, chainId };
    } catch (e) {
      // A drip that did not go out must not cost the caller their allowance.
      // (A send that merely got no answer does not end up here if the node has
      // the transaction: the sender looks it up and reports it as sent.)
      if (reservation?.id !== undefined) this.limits.release(reservation.id);

      if (e instanceof FaucetEmptyError) return { ok: false, code: "faucet_empty" };
      if (e instanceof FaucetConfigError) {
        return { ok: false, code: "misconfigured", message: e.message };
      }
      console.error(
        JSON.stringify({
          message: "drip failed",
          chainId,
          to,
          ...describeError(e, this.connection?.rpcUrl),
        }),
      );
      return { ok: false, code: "drip_failed" };
    } finally {
      this.active -= 1;
    }
  }

  /**
   * Runs when the earliest stored row leaves its window. Rows are otherwise
   * only cleared out by the next drip, and on a quiet day there may not be
   * one — a client's address should not sit in storage waiting for it.
   */
  async alarm() {
    const next = this.limits.prune();
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  /** Make sure alarm() will run once the drip just recorded has aged out. */
  async #scheduleCleanup() {
    const due = Date.now() + IP_WINDOW_MS;
    const scheduled = await this.ctx.storage.getAlarm();
    if (scheduled === null || scheduled > due) await this.ctx.storage.setAlarm(due);
  }

  #setup(chainId) {
    if (!this.connection) {
      const connection = connect(chainId, this.env);
      if (!connection) throw new FaucetConfigError(`Chain ${chainId} is not allowlisted.`);
      this.connection = { ...connection, sender: new DripSender(connection) };
    }

    const amount = this.env.FAUCET_DRIP_AVAX || "0.05";
    let value = 0n;
    try {
      value = parseEther(amount);
    } catch {
      // Falls through to the check below.
    }
    if (value <= 0n) throw new FaucetConfigError("FAUCET_DRIP_AVAX is not a valid amount.");

    return { sender: this.connection.sender, amount, value };
  }
}
