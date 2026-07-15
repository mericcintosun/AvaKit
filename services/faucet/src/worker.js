import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddress,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * AvaKit faucet — a Cloudflare Worker that drips testnet AVAX so a new user's
 * first transaction is funded with no wallet setup. It holds the funding key as a
 * Worker secret and rate-limits in KV, so AvaKit client code never touches a
 * private key.
 *
 *   POST /fund   { address, chainId? }  → { txHash, amount, chainId }
 *   GET  /health                        → { ok, address, chainId, balance }
 *
 * Point a dapp at it: <AvaKitProvider faucetUrl="https://<worker>/fund">
 *
 * ⚠️ Testnet only. CHAINS is an allowlist, so this can never drip real funds.
 *    Add a captcha (Cloudflare Turnstile) in front before advertising it widely —
 *    the KV limits below are a floor, not a full anti-abuse defense.
 */

/** Testnet allowlist — chainId → RPC. Anything not listed is refused. */
const CHAINS = {
  43113: { name: "Avalanche Fuji", rpc: "https://api.avax-test.network/ext/bc/C/rpc" },
};
const DEFAULT_CHAIN_ID = 43113;

const ADDRESS_TTL_S = 24 * 60 * 60; // one drip per address / 24h
const IP_TTL_S = 60 * 60; // per-IP window
// A whole hackathon room shares one NAT'd IP, and that room is exactly the
// audience this faucet exists for — so this is deliberately generous. It is the
// real drain defense though (the per-address limit is trivially bypassed by
// generating addresses), so it caps a single IP at IP_MAX * drip per hour.
// Add Cloudflare Turnstile before advertising widely; that, not this, is the fix.
const IP_MAX = 20;

function clientsFor(chainId, env) {
  const cfg = CHAINS[chainId];
  if (!cfg) return null;
  const rpc = env.FAUCET_FUJI_RPC || cfg.rpc;
  const chain = defineChain({
    id: chainId,
    name: cfg.name,
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const account = privateKeyToAccount(env.AVAKIT_FAUCET_KEY);
  return {
    account,
    publicClient: createPublicClient({ chain, transport: http(rpc) }),
    walletClient: createWalletClient({ account, chain, transport: http(rpc) }),
  };
}

function cors(env) {
  return {
    "access-control-allow-origin": env.FAUCET_CORS_ORIGIN || "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-max-age": "86400",
  };
}

function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors(env) },
  });
}

/**
 * Preflight. This MUST be a null body: constructing a Response with a body and a
 * 204 throws, which would take the whole Worker down and leave the browser with
 * no CORS headers at all — i.e. every /fund call fails before it is even sent.
 */
function preflight(env) {
  return new Response(null, { status: 204, headers: cors(env) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return preflight(env);

    if (request.method === "GET" && url.pathname === "/health") {
      if (!env.AVAKIT_FAUCET_KEY) return json({ error: "Faucet key not configured." }, 500, env);
      const c = clientsFor(DEFAULT_CHAIN_ID, env);
      const balance = await c.publicClient
        .getBalance({ address: c.account.address })
        .catch(() => null);
      return json(
        {
          ok: true,
          address: c.account.address,
          chainId: DEFAULT_CHAIN_ID,
          balance: balance != null ? balance.toString() : null,
        },
        200,
        env,
      );
    }

    if (request.method === "POST" && url.pathname === "/fund") {
      if (!env.AVAKIT_FAUCET_KEY) return json({ error: "Faucet key not configured." }, 500, env);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400, env);
      }
      if (!body || typeof body.address !== "string" || !isAddress(body.address)) {
        return json({ error: "A valid 0x address is required." }, 400, env);
      }

      const chainId = Number(body.chainId ?? DEFAULT_CHAIN_ID);
      const clients = clientsFor(chainId, env);
      if (!clients) {
        return json({ error: `Unsupported or non-testnet chainId ${chainId}.` }, 400, env);
      }

      const address = body.address.toLowerCase();
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const addrKey = `a:${address}`;
      const ipKey = `i:${ip}`;

      // KV is eventually consistent, so these limits are a floor rather than a
      // hard guarantee — paired with a tiny drip that is the intended trade-off.
      if (await env.FAUCET_KV.get(addrKey)) {
        return json({ error: "This address was funded recently. Try again later." }, 429, env);
      }
      const hits = Number((await env.FAUCET_KV.get(ipKey)) ?? "0");
      if (hits >= IP_MAX) {
        return json({ error: "Rate limit reached. Try again later." }, 429, env);
      }

      try {
        const dripAvax = env.FAUCET_DRIP_AVAX || "0.05";
        const drip = parseEther(dripAvax);
        const balance = await clients.publicClient.getBalance({ address: clients.account.address });
        if (balance < drip) {
          return json({ error: "Faucet is empty. Please top it up." }, 503, env);
        }

        // Reserve before sending so a burst can't slip through the await.
        await env.FAUCET_KV.put(addrKey, "1", { expirationTtl: ADDRESS_TTL_S });
        await env.FAUCET_KV.put(ipKey, String(hits + 1), { expirationTtl: IP_TTL_S });

        const txHash = await clients.walletClient.sendTransaction({
          account: clients.account,
          to: body.address,
          value: drip,
        });
        return json({ txHash, amount: dripAvax, chainId }, 200, env);
      } catch (e) {
        // Release the address reservation so a failed drip can be retried.
        await env.FAUCET_KV.delete(addrKey).catch(() => {});
        return json({ error: e instanceof Error ? e.message : "Drip failed." }, 502, env);
      }
    }

    return json({ error: "Not found." }, 404, env);
  },
};
