import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { BrowserContext, Request, Route } from "@playwright/test";
import { isAddress, numberToHex } from "viem";
import { rpc } from "./anvil";

/** One request the page made to the faucet, and how the stand-in answered it. */
export interface FaucetCall {
  address: string;
  chainId: unknown;
  status: number;
}

/** What the page tried to reach outside the app while the routes were in place. */
export interface LocalNetwork {
  /** Faucet requests, in order. */
  readonly faucetCalls: FaucetCall[];
  /** JSON-RPC calls answered by anvil, as method names, in order. */
  readonly rpcMethods: string[];
  /** Requests to a host these tests do not serve, as "METHOD url". They were blocked. */
  readonly blocked: string[];
}

export interface LocalNetworkOptions {
  /** Origin of the app under test. Its own requests are left alone. */
  appOrigin: string;
  /** anvil's JSON-RPC URL. */
  anvilUrl: string;
  /** The Fuji JSON-RPC endpoints the app calls. anvil answers every one of them. */
  rpcUrls: readonly string[];
  /** The faucet endpoint the app was built with. */
  faucetUrl: string;
  /** Chain the faucet stand-in serves (Fuji). */
  chainId: number;
  /** What one drip is, as the AvaKit faucet reports it: AVAX as text, and in wei. */
  drip: { amount: string; wei: bigint };
}

/** What the AvaKit faucet answers when it refuses (services/faucet/src/worker.js). */
const REFUSALS = {
  invalid_address: [400, "A valid 0x address is required."],
  unsupported_chain: [400, "Unsupported or non-testnet chainId."],
  address_limited: [429, "This address was funded recently. Try again later."],
} as const;

/** CORS headers for answers to cross-origin requests from the page. */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const JSON_CORS = { ...CORS, "content-type": "application/json" };

/**
 * Point every request the app makes to the outside world somewhere local:
 *
 * - Fuji's JSON-RPC endpoints are answered by anvil (started with chain id
 *   43113, so what the page signs for Fuji is valid there).
 * - The faucet is answered by a stand-in that behaves like the AvaKit faucet:
 *   one drip per address (a second request is refused as `address_limited`),
 *   Fuji only, and the drip lands at once through `anvil_setBalance`.
 * - The Draco decoder that <model-viewer> fetches from www.gstatic.com is
 *   served from the copy three.js ships (byte-identical to gstatic's 1.5.6
 *   build when this was written), so /avatar renders without the network.
 * - Anything else is blocked and recorded in `blocked`, so a test can fail
 *   when the page reaches for a host nobody accounted for.
 *
 * The routes are set on the browser context, so they also cover popups. A
 * `page.route` added later for the same URL takes precedence over them.
 *
 * `stop()` is for the end of the test, before anvil goes away: from then on
 * every outside request is refused, so a page that is still polling neither
 * reaches the real network nor trips over the stopped node.
 */
export async function routeLocalNetwork(
  context: BrowserContext,
  options: LocalNetworkOptions,
): Promise<{ network: LocalNetwork; stop: () => void }> {
  const network: LocalNetwork = { faucetCalls: [], rpcMethods: [], blocked: [] };
  const rpcUrls = new Set(options.rpcUrls.map(withoutTrailingSlash));
  const faucetUrl = withoutTrailingSlash(options.faucetUrl);
  const funded = new Set<string>();
  let stopped = false;

  async function answerRpc(route: Route, request: Request) {
    const body = request.postData() ?? "";
    network.rpcMethods.push(...rpcMethodNames(body));
    const response = await fetch(options.anvilUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    await route.fulfill({
      status: response.status,
      headers: JSON_CORS,
      body: await response.text(),
    });
  }

  async function answerFaucet(route: Route, request: Request) {
    let payload: { address?: unknown; chainId?: unknown } = {};
    try {
      payload = JSON.parse(request.postData() ?? "{}") as typeof payload;
    } catch {
      // Answered below as an invalid address, like the real faucet does.
    }
    const address = typeof payload.address === "string" ? payload.address : "";
    const chainId = payload.chainId ?? options.chainId;

    const refuse = async (code: keyof typeof REFUSALS) => {
      const [status, error] = REFUSALS[code];
      network.faucetCalls.push({ address, chainId: payload.chainId, status });
      await route.fulfill({ status, headers: JSON_CORS, body: JSON.stringify({ error, code }) });
    };

    if (!isAddress(address)) return refuse("invalid_address");
    if (Number(chainId) !== options.chainId) return refuse("unsupported_chain");
    if (funded.has(address.toLowerCase())) return refuse("address_limited");
    funded.add(address.toLowerCase());

    await rpc(options.anvilUrl, "anvil_setBalance", [address, numberToHex(options.drip.wei)]);
    network.faucetCalls.push({ address, chainId: payload.chainId, status: 200 });
    await route.fulfill({
      status: 200,
      headers: JSON_CORS,
      body: JSON.stringify({ amount: options.drip.amount, chainId: options.chainId }),
    });
  }

  async function answer(route: Route, request: Request) {
    const url = new URL(request.url());
    const bare = withoutTrailingSlash(`${url.origin}${url.pathname}`);

    // A preflight never carries the call itself; it only asks for permission.
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (rpcUrls.has(bare) && request.method() === "POST") return answerRpc(route, request);
    if (bare === faucetUrl && request.method() === "POST") return answerFaucet(route, request);

    const draco = await localDracoDecoder(url);
    if (draco) {
      return route.fulfill({
        status: 200,
        headers: { ...CORS, "content-type": draco.contentType },
        body: draco.body,
      });
    }

    const hint = looksLikeJsonRpc(request)
      ? " (a JSON-RPC call: if it is a Fuji endpoint, add it to the endpoints anvil answers)"
      : "";
    network.blocked.push(`${request.method()} ${request.url()}${hint}`);
    return route.abort("blockedbyclient");
  }

  await context.route(
    (url) => url.origin !== options.appOrigin && url.protocol.startsWith("http"),
    async (route, request) => {
      if (stopped) return route.abort("blockedbyclient").catch(() => {});
      try {
        await answer(route, request);
      } catch (error) {
        // Once the test is over, anvil may be gone and the page closing: a
        // request still in flight then fails, and that is nobody's error.
        if (!stopped) throw error;
      }
    },
  );

  return {
    network,
    stop: () => {
      stopped = true;
    },
  };
}

function withoutTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** The method names in a JSON-RPC request body (a single call or a batch). */
function rpcMethodNames(body: string): string[] {
  try {
    const parsed = JSON.parse(body) as unknown;
    const calls = Array.isArray(parsed) ? parsed : [parsed];
    return calls.map((call) =>
      typeof call === "object" && call !== null && "method" in call ? String(call.method) : "?",
    );
  } catch {
    return ["?"];
  }
}

function looksLikeJsonRpc(request: Request): boolean {
  return request.method() === "POST" && /"jsonrpc"\s*:\s*"2\.0"/.test(request.postData() ?? "");
}

const DRACO_PATH =
  /^\/draco\/versioned\/decoders\/[\d.]+\/(draco_wasm_wrapper\.js|draco_decoder\.wasm|draco_decoder\.js)$/;
const requireFromHere = createRequire(import.meta.url);

/** gstatic's Draco decoder, served from the copy three.js ships, or null for any other URL. */
async function localDracoDecoder(url: URL) {
  if (url.hostname !== "www.gstatic.com") return null;
  const file = DRACO_PATH.exec(url.pathname)?.[1];
  if (!file) return null;
  // three is a dependency of @google/model-viewer, not of this app, so it is
  // resolved from there.
  const requireFromViewer = createRequire(requireFromHere.resolve("@google/model-viewer"));
  const path = requireFromViewer.resolve(`three/examples/jsm/libs/draco/${file}`);
  return {
    body: await readFile(path),
    contentType: file.endsWith(".wasm") ? "application/wasm" : "text/javascript",
  };
}
