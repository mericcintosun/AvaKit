import { createServer } from "node:http";
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
 * AvaKit faucet — a tiny, self-hostable service that drips testnet AVAX so a new
 * user's first transaction is funded with no wallet setup. It holds the funding
 * key (from env, never in code) and enforces rate limits server-side.
 *
 * Endpoints:
 *   POST /fund   { address, chainId? }  → sends a small drip, returns { txHash, amount }
 *   GET  /health                        → { ok, address, chainId, balance }
 *
 * Deploy this behind AvaKit Cloud (or self-host). Point a dapp at it via
 * `<AvaKitProvider faucetUrl="https://faucet.example/fund">`.
 *
 * ⚠️ Testnet only. The allowlist below refuses any non-testnet chain so this can
 *    never drip real funds. Put a captcha (e.g. Cloudflare Turnstile) in front in
 *    production — the in-memory limits here are a floor, not a full defense.
 */

// --- config (all from env; safe defaults) ---------------------------------
const PORT = Number(process.env.PORT ?? "8787");
const DRIP_AVAX = process.env.FAUCET_DRIP_AVAX ?? "0.05";
const CORS_ORIGIN = process.env.FAUCET_CORS_ORIGIN ?? "*";
const KEY = process.env.AVAKIT_FAUCET_KEY;

// Testnet allowlist — chainId → RPC. Refuses anything not listed (no mainnet).
const CHAINS = {
  43113: {
    name: "Avalanche Fuji",
    rpcUrl: process.env.FAUCET_FUJI_RPC ?? "https://api.avax-test.network/ext/bc/C/rpc",
  },
};
const DEFAULT_CHAIN_ID = 43113;

// --- abuse controls (in-memory; swap for a store in a multi-instance deploy) --
const ADDRESS_COOLDOWN_MS = 24 * 60 * 60 * 1000; // one drip per address / 24h
const IP_WINDOW_MS = 60 * 60 * 1000; // per-IP window: 1h
const IP_MAX = 5; // ...max drips per IP per window
const lastByAddress = new Map(); // address(lower) → ms
const hitsByIp = new Map(); // ip → number[] (timestamps)

function ipAllowed(ip, now) {
  const hits = (hitsByIp.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  if (hits.length >= IP_MAX) {
    hitsByIp.set(ip, hits);
    return false;
  }
  hits.push(now);
  hitsByIp.set(ip, hits);
  return true;
}

function addressAllowed(address, now) {
  const last = lastByAddress.get(address);
  return !last || now - last >= ADDRESS_COOLDOWN_MS;
}

// --- viem clients ----------------------------------------------------------
function clientsFor(chainId) {
  const cfg = CHAINS[chainId];
  if (!cfg) return null;
  const chain = defineChain({
    id: chainId,
    name: cfg.name,
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const account = privateKeyToAccount(KEY);
  return {
    account,
    publicClient: createPublicClient({ chain, transport: http(cfg.rpcUrl) }),
    walletClient: createWalletClient({ account, chain, transport: http(cfg.rpcUrl) }),
  };
}

// --- http helpers ----------------------------------------------------------
function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": CORS_ORIGIN,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 4096) req.destroy(); // cap body size
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

// --- server ----------------------------------------------------------------
const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    const c = clientsFor(DEFAULT_CHAIN_ID);
    if (!c) return send(res, 500, { error: "Faucet misconfigured." });
    const balance = await c.publicClient
      .getBalance({ address: c.account.address })
      .catch(() => null);
    return send(res, 200, {
      ok: true,
      address: c.account.address,
      chainId: DEFAULT_CHAIN_ID,
      balance: balance != null ? balance.toString() : null,
    });
  }

  if (req.method === "POST" && url.pathname === "/fund") {
    if (!KEY) return send(res, 500, { error: "Faucet key not configured." });
    const body = await readJson(req);
    if (!body || typeof body.address !== "string" || !isAddress(body.address)) {
      return send(res, 400, { error: "A valid 0x address is required." });
    }
    const chainId = Number(body.chainId ?? DEFAULT_CHAIN_ID);
    const clients = clientsFor(chainId);
    if (!clients) {
      return send(res, 400, { error: `Unsupported or non-testnet chainId ${chainId}.` });
    }

    const address = body.address.toLowerCase();
    const now = Date.now();
    const ip =
      (req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ??
        req.socket.remoteAddress) ||
      "unknown";

    if (!addressAllowed(address, now)) {
      return send(res, 429, { error: "This address was funded recently. Try again later." });
    }
    if (!ipAllowed(ip, now)) {
      return send(res, 429, { error: "Rate limit reached. Try again later." });
    }

    try {
      const drip = parseEther(DRIP_AVAX);
      const balance = await clients.publicClient.getBalance({ address: clients.account.address });
      if (balance < drip) {
        return send(res, 503, { error: "Faucet is empty. Please top it up." });
      }
      const txHash = await clients.walletClient.sendTransaction({
        account: clients.account,
        to: body.address,
        value: drip,
      });
      lastByAddress.set(address, now);
      return send(res, 200, { txHash, amount: DRIP_AVAX, chainId });
    } catch (e) {
      // Roll back the address cooldown so a failed drip can be retried.
      lastByAddress.delete(address);
      return send(res, 502, { error: e instanceof Error ? e.message : "Drip failed." });
    }
  }

  return send(res, 404, { error: "Not found." });
});

server.listen(PORT, () => {
  process.stdout.write(`avakit-faucet listening on :${PORT} (drip ${DRIP_AVAX} AVAX)\n`);
  if (!KEY) {
    process.stderr.write("⚠️  AVAKIT_FAUCET_KEY is not set — /fund will refuse requests.\n");
  }
});
