import { DurableObject } from "cloudflare:workers";
import { isAddress } from "viem";
import {
  dailyBudgets,
  deployedVersion,
  dripAmount,
  isPaused,
  lowBalance,
  tokenRequired,
  turnstileOrigins,
  UNVERIFIED,
  VERIFIED,
} from "./config.js";
import { clientKey } from "./ip.js";
import { BUSY_RETRY_S, DripLimits, FAILURE_WINDOW_MS, IP_WINDOW_MS } from "./limits.js";
import {
  CHAINS,
  connect,
  DEFAULT_CHAIN_ID,
  DripSender,
  describeError,
  FaucetConfigError,
  FaucetEmptyError,
  FaucetRecipientError,
} from "./sender.js";
import { verifyTurnstile } from "./turnstile.js";

/**
 * AvaKit faucet — a Cloudflare Worker that drips testnet AVAX so a new user's
 * first transaction is funded with no wallet setup. It holds the funding key as a
 * Worker secret, so AvaKit client code never touches a private key.
 *
 *   POST /fund   { address, chainId?, turnstileToken? }  → { txHash, amount, chainId }
 *   GET  /health → { ok, version, address, chainId, balance, low, lowBelow, amount,
 *                    turnstile, paused, today }
 *
 * Point a dapp at it: <AvaKitProvider faucetUrl="https://<worker>/fund">
 *
 * The Worker itself is stateless: it validates the request, checks a Turnstile
 * token if one was sent or is required, and hands the drip to the `Faucet`
 * Durable Object. That object is the one place that both counts drips and
 * signs them, which is what makes the limits exact and keeps two drips off the
 * same nonce.
 *
 * ⚠️ Testnet only. CHAINS is an allowlist, so this can never drip real funds.
 *    The per-client limits bound what one network can take, and the daily
 *    budgets bound what all of them can take together; FAUCET_PAUSED stops
 *    everything. PROTECTION.md says what each of these does and does not stop.
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
  contract_recipient: [
    400,
    "This address is a contract the faucet does not fund. Use a wallet address.",
  ],
  turnstile_required: [403, "Verification required."],
  turnstile_failed: [403, "Verification failed. Try again."],
  turnstile_unavailable: [503, "Verification is unavailable. Try again shortly."],
  not_found: [404, "Not found."],
  address_limited: [429, "This address was funded recently. Try again later."],
  ip_limited: [429, "Rate limit reached. Try again later."],
  daily_limited: [
    429,
    "The faucet has sent all the drips it gives out today. Try again after 00:00 UTC.",
  ],
  faucet_paused: [503, "The faucet is paused. Try again later."],
  faucet_busy: [503, "The faucet is busy. Try again in a few seconds."],
  faucet_empty: [503, "Faucet is empty. Please top it up."],
  drip_failed: [502, "The faucet could not send the drip. Try again shortly."],
  misconfigured: [500, "Faucet is misconfigured."],
  internal: [500, "Faucet error. Try again shortly."],
};

/** Drips one object will prepare or send at once before asking callers to come back. */
const MAX_ACTIVE_DRIPS = 64;
/**
 * …and how many of those one client may hold. Eight lets a room behind one IP
 * click together — the AvaKit client asks a busy faucet again, twice, and three
 * rounds of eight cover the 20 drips an hour that room is allowed — while no
 * single client can take more than an eighth of the slots.
 */
const MAX_ACTIVE_PER_CLIENT = 8;

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

/** The one Durable Object that counts and sends the drips for `chainId`. */
function faucetFor(env, chainId) {
  return env.FAUCET.get(env.FAUCET.idFromName(String(chainId)));
}

/**
 * The faucet's state, for a client, an operator or a monitor to read without
 * a drip. It names the faucet's own address and balance, the commit it was
 * deployed from and today's use of the budgets, and no secret.
 *
 * `ok` says the faucet is set up and its Durable Object answers; whether it
 * would drip right now is `paused`, `low` and `today`. `turnstile` is answered
 * for the origin this request came from (hence `Vary: Origin`).
 */
async function health(request, env) {
  const version = deployedVersion(env);
  // Not cached by anything on the way: the balance and the counts are live.
  const headers = { "cache-control": "no-store", vary: "origin" };
  const failed = (status, error, code) =>
    json({ ok: false, version, error, ...(code ? { code } : {}) }, status, env, headers);

  let settings;
  try {
    if (!env.AVAKIT_FAUCET_KEY) throw new FaucetConfigError(KEY_MISSING.message);
    // Every setting is read here, so that /health — and the deploy workflow,
    // which asks it after every deploy — reports a bad one before a drip does.
    settings = {
      connection: connect(DEFAULT_CHAIN_ID, env),
      amount: dripAmount(env).amount,
      low: lowBalance(env),
      turnstile: tokenRequired(env, request.headers.get("origin")),
    };
    dailyBudgets(env);
    turnstileOrigins(env);
  } catch (e) {
    if (e instanceof FaucetConfigError) return failed(500, e.message, "misconfigured");
    throw e;
  }

  const { account, client } = settings.connection;
  const [balance, today] = await Promise.all([
    client.getBalance({ address: account.address }).catch(() => null),
    faucetFor(env, DEFAULT_CHAIN_ID)
      .usage()
      .catch((e) => {
        console.error(
          JSON.stringify({
            message: "health: no answer from the Durable Object",
            error: String(e),
          }),
        );
        return null;
      }),
  ]);
  if (today === null) return failed(503, "The faucet's Durable Object did not answer.");

  return json(
    {
      ok: true,
      version,
      address: account.address,
      chainId: DEFAULT_CHAIN_ID,
      // Wei, as text; null when the RPC could not be asked.
      balance: balance != null ? balance.toString() : null,
      // Whether the balance is under `lowBelow` (AVAX); null when it is unknown.
      low: balance != null ? balance < settings.low.value : null,
      lowBelow: settings.low.text,
      // What one drip sends, in AVAX — the `amount` POST /fund answers with.
      amount: settings.amount,
      // Whether POST /fund, sent from the same origin as this request, needs a `turnstileToken`.
      turnstile: settings.turnstile,
      // Whether FAUCET_PAUSED has switched POST /fund off.
      paused: isPaused(env),
      // Drips given out today (UTC) from each budget, and each budget's size.
      today,
    },
    200,
    env,
    headers,
  );
}

/**
 * Which budget a request draws on, or the refusal that ends it here.
 *
 * Without TURNSTILE_SECRET there is no captcha and every drip is unverified. With
 * it, a token that was sent is always checked, and a good one makes the drip a
 * verified one, whatever the request's origin. A request without a token is
 * refused if its origin is one that has to send one (every origin, unless
 * TURNSTILE_ORIGINS narrows that down), and otherwise draws on the unverified
 * budget like any other.
 */
async function laneFor(request, env, body, ip) {
  if (!env.TURNSTILE_SECRET) return { lane: UNVERIFIED };

  if (!body.turnstileToken) {
    if (tokenRequired(env, request.headers.get("origin"))) {
      return { refused: { code: "turnstile_required" } };
    }
    return { lane: UNVERIFIED };
  }

  // It runs here, at the edge, so a bot never gets as far as the Durable Object.
  const verdict = await verifyTurnstile({
    secret: env.TURNSTILE_SECRET,
    token: body.turnstileToken,
    ip,
    // Unset in production: it only lets a test stand in for Cloudflare.
    url: env.TURNSTILE_VERIFY_URL || undefined,
  });
  if (verdict !== "ok") return { refused: { code: `turnstile_${verdict}` } };
  return { lane: VERIFIED };
}

async function fund(request, env, ctx) {
  // The kill switch comes first: while it is on, nothing else is looked at.
  if (isPaused(env)) return refuse({ code: "faucet_paused" }, env);
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

  const { lane, refused } = await laneFor(request, env, body, ip);
  if (refused) return refuse(refused, env);

  // One object per chain: it owns that chain's limits and the account's nonce.
  const faucet = faucetFor(env, chainId);
  const drip = (async () =>
    faucet.drip({ chainId, to: body.address, client: clientKey(ip), lane }))();
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
      if (request.method === "GET" && url.pathname === "/health") {
        return await health(request, env);
      }
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
    /** client → how many of the active drips are theirs. */
    this.activeBy = new Map();
    this.connection = null;
  }

  /**
   * Fund `to`, unless a limit says no. Never throws for an expected failure:
   * the caller gets `{ ok: false, code }` and maps it to a response.
   *
   * `lane` is the daily budget the drip is drawn from: "verified" only when
   * the Worker checked a Turnstile token for it, "unverified" otherwise — and
   * for anything else, so a caller from before the budgets is counted too.
   */
  async drip({ chainId, to, client, lane }) {
    const address = to.toLowerCase();
    const drawn = lane === VERIFIED ? VERIFIED : UNVERIFIED;
    let budget;
    try {
      budget = dailyBudgets(this.env)[drawn];
    } catch (e) {
      if (e instanceof FaucetConfigError) {
        return { ok: false, code: "misconfigured", message: e.message };
      }
      throw e;
    }
    const limit = { address, client, lane: drawn, budget };

    // Cheap, read-only refusals first, so a caller that is over a limit, keeps
    // failing or is flooding costs neither an RPC call nor a storage write.
    const refused = this.limits.refusal(limit);
    if (refused) return { ok: false, ...refused };
    const mine = this.activeBy.get(client) ?? 0;
    if (this.active >= MAX_ACTIVE_DRIPS || mine >= MAX_ACTIVE_PER_CLIENT) {
      return { ok: false, code: "faucet_busy", retryAfter: BUSY_RETRY_S };
    }

    this.active += 1;
    this.activeBy.set(client, mine + 1);
    let reservation;
    try {
      const { sender, amount, value } = this.#setup(chainId);
      const request = await sender.prepare({ to, value });

      // Only now, with a transaction ready to send, is a slot taken — an empty
      // faucet or an unreachable RPC is turned away above without writing a
      // row. Other requests ran during that await, so reserve() checks again.
      reservation = this.limits.reserve(limit);
      if (reservation.refused) return { ok: false, ...reservation.refused };
      await this.#scheduleCleanup(IP_WINDOW_MS);

      const txHash = await sender.broadcast(request);
      this.limits.settle(reservation.id);
      return { ok: true, txHash, amount, chainId };
    } catch (e) {
      // A drip that did not go out must not cost the caller their allowance.
      // (A send that merely got no answer does not end up here if the node has
      // the transaction: the sender looks it up and reports it as sent.)
      if (reservation?.id !== undefined) this.limits.release(reservation.id);

      // The faucet's own state: nothing a caller brings about by what it asks for.
      if (e instanceof FaucetEmptyError) return { ok: false, code: "faucet_empty" };
      if (e instanceof FaucetConfigError) {
        return { ok: false, code: "misconfigured", message: e.message };
      }

      // Any other failure may be the caller's doing — the recipient is theirs
      // to choose — and it cost RPC calls and a slot all the same. It is
      // counted, so a client that only ever fails is soon refused up front.
      this.limits.fail({ client });
      await this.#scheduleCleanup(FAILURE_WINDOW_MS);

      if (e instanceof FaucetRecipientError) return { ok: false, code: "contract_recipient" };
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
      const left = this.activeBy.get(client) - 1;
      if (left > 0) this.activeBy.set(client, left);
      else this.activeBy.delete(client);
    }
  }

  /**
   * Today's use of the daily budgets, for /health: the drips each one has
   * given out since 00:00 UTC (those still being sent included) and its size.
   * Reads only, and nothing in it names a caller.
   */
  usage() {
    const budgets = dailyBudgets(this.env);
    const used = this.limits.usage();
    return {
      day: used.day,
      [UNVERIFIED]: { drips: used[UNVERIFIED], max: budgets[UNVERIFIED] },
      [VERIFIED]: { drips: used[VERIFIED], max: budgets[VERIFIED] },
    };
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

  /** Make sure alarm() will run once the row just recorded, kept for `window` ms, has aged out. */
  async #scheduleCleanup(window) {
    const due = Date.now() + window;
    const scheduled = await this.ctx.storage.getAlarm();
    if (scheduled === null || scheduled > due) await this.ctx.storage.setAlarm(due);
  }

  #setup(chainId) {
    if (!this.connection) {
      const connection = connect(chainId, this.env);
      if (!connection) throw new FaucetConfigError(`Chain ${chainId} is not allowlisted.`);
      this.connection = { ...connection, sender: new DripSender(connection) };
    }

    return { sender: this.connection.sender, ...dripAmount(this.env) };
  }
}
