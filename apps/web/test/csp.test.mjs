// The Content-Security-Policy that proxy.ts sends with every page (lib/csp.ts).
// Run with `pnpm --filter @avakit/web test` (plain `node --test`, no build needed).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as coreChains from "@avakit/core/chains";
// The function Next.js itself runs on the request's policy to find the nonce for
// its scripts. It is internal: if an upgrade moves it, find its new home (grep
// node_modules/next/dist for getScriptNonceFromHeader) rather than copy it here.
import { getScriptNonceFromHeader } from "next/dist/server/app-render/get-script-nonce-from-header.js";

import {
  contentSecurityPolicy,
  createNonce,
  DRACO_DECODER_SOURCE,
  httpOrigin,
  rpcOrigins,
} from "../lib/csp.ts";

const { fuji } = coreChains;
const web = new URL("../", import.meta.url);
const FAUCET = "https://avakit-faucet.avakit.workers.dev/fund";

// The origins of the installed @avakit/core's Fuji RPC endpoints, built the way
// lib/csp.ts builds them: `rpcUrl`, then the fallbacks in `rpcUrls` (a core
// that predates `rpcUrls` has `rpcUrl` alone). Read from the installed core, so
// the exact connect-src lists below follow an upgrade that adds an endpoint.
const FUJI_RPC_ORIGINS = [
  ...new Set([fuji.rpcUrl, ...(fuji.rpcUrls ?? [])].map((url) => new URL(url).origin)),
];

/** "a b c; d e" → Map { "a" => ["b", "c"], "d" => ["e"] }, failing on a repeated directive. */
function parse(policy) {
  const map = new Map();
  for (const part of policy.split("; ")) {
    const [name, ...sources] = part.split(" ");
    assert.ok(!map.has(name), `${name} appears twice`);
    map.set(name, sources);
  }
  return map;
}

test("Next.js finds the nonce in the policy, so its own scripts get it", () => {
  const nonce = createNonce();
  for (const dev of [false, true]) {
    assert.equal(getScriptNonceFromHeader(contentSecurityPolicy({ nonce, dev })), nonce);
  }
});

test("only scripts with this response's nonce run, and what they load", () => {
  const nonce = createNonce();
  const scripts = parse(contentSecurityPolicy({ nonce, faucetUrl: FAUCET })).get("script-src");
  assert.ok(scripts.includes(`'nonce-${nonce}'`));
  assert.ok(scripts.includes("'strict-dynamic'"));
  // Nothing that would let an injected script run in a browser that ignores
  // 'strict-dynamic': no inline scripts, no eval, no scheme or host wildcard.
  for (const source of [
    "'unsafe-inline'",
    "'unsafe-eval'",
    "'unsafe-hashes'",
    "*",
    "https:",
    "http:",
    "data:",
    "blob:",
  ]) {
    assert.ok(!scripts.includes(source), `script-src allows ${source}`);
  }
  assert.deepEqual(
    scripts.filter((s) => !s.startsWith("'nonce-")),
    ["'self'", "'strict-dynamic'", "'wasm-unsafe-eval'"],
  );
});

test("eval is allowed only by `next dev`", () => {
  const nonce = createNonce();
  assert.ok(!contentSecurityPolicy({ nonce }).includes("'unsafe-eval'"));
  assert.ok(
    parse(contentSecurityPolicy({ nonce, dev: true }))
      .get("script-src")
      .includes("'unsafe-eval'"),
  );
});

test("no plugins; <base>, form posts and framing stay on the site", () => {
  const policy = parse(contentSecurityPolicy({ nonce: createNonce() }));
  assert.deepEqual(policy.get("default-src"), ["'self'"]);
  assert.deepEqual(policy.get("object-src"), ["'none'"]);
  assert.deepEqual(policy.get("base-uri"), ["'self'"]);
  assert.deepEqual(policy.get("form-action"), ["'self'"]);
  assert.deepEqual(policy.get("frame-ancestors"), ["'self'"]);
});

test("connect-src is the site, the Fuji RPC endpoints the wallet uses, the faucet, and the Draco decoder", () => {
  const connect = parse(contentSecurityPolicy({ nonce: createNonce(), faucetUrl: FAUCET })).get(
    "connect-src",
  );
  assert.deepEqual(connect, [
    "'self'",
    ...FUJI_RPC_ORIGINS,
    "https://avakit-faucet.avakit.workers.dev",
    DRACO_DECODER_SOURCE,
    "blob:",
  ]);
});

test("connect-src allows every Fuji RPC endpoint the installed @avakit/core may call", () => {
  // A core with fallback endpoints exports rpcEndpoints: the list its clients
  // and the burner wallet move along when an endpoint fails or rate-limits. A
  // core without it sends every request to rpcUrl.
  const endpoints =
    typeof coreChains.rpcEndpoints === "function" ? coreChains.rpcEndpoints(fuji) : [fuji.rpcUrl];
  const connect = parse(contentSecurityPolicy({ nonce: createNonce() })).get("connect-src");
  for (const url of endpoints) {
    assert.ok(connect.includes(new URL(url).origin), `connect-src blocks ${url}`);
  }
});

test("a chain with fallback endpoints gets each of their origins, once, primary first", () => {
  const chain = {
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    rpcUrls: [
      "https://api.avax-test.network/ext/bc/C/rpc",
      "https://avalanche-fuji-c-chain-rpc.publicnode.com",
    ],
  };
  const connect = parse(
    contentSecurityPolicy({ nonce: createNonce(), faucetUrl: FAUCET, chain }),
  ).get("connect-src");
  assert.deepEqual(connect, [
    "'self'",
    "https://api.avax-test.network",
    "https://avalanche-fuji-c-chain-rpc.publicnode.com",
    "https://avakit-faucet.avakit.workers.dev",
    DRACO_DECODER_SOURCE,
    "blob:",
  ]);
  // rpcUrl counts even when rpcUrls leaves it out, and what is not an http(s)
  // URL adds nothing.
  assert.deepEqual(
    rpcOrigins({
      rpcUrl: "http://127.0.0.1:9650/ext/bc/C/rpc",
      rpcUrls: ["https://a.example/rpc", "javascript:alert(1)", "", "not a url"],
    }),
    ["http://127.0.0.1:9650", "https://a.example"],
  );
  assert.deepEqual(rpcOrigins({ rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc" }), [
    "https://api.avax-test.network",
  ]);
});

test("a deploy without a faucet, or with a faucet URL that is not http(s), adds no source", () => {
  const without = parse(contentSecurityPolicy({ nonce: createNonce() })).get("connect-src");
  assert.deepEqual(without, ["'self'", ...FUJI_RPC_ORIGINS, DRACO_DECODER_SOURCE, "blob:"]);
  for (const faucetUrl of [
    "",
    "not a url",
    "javascript:alert(1)",
    "data:text/plain,x",
    "ftp://x.dev",
  ]) {
    assert.deepEqual(
      parse(contentSecurityPolicy({ nonce: createNonce(), faucetUrl })).get("connect-src"),
      without,
      faucetUrl,
    );
  }
  assert.equal(httpOrigin("http://localhost:8787/fund"), "http://localhost:8787");
  assert.equal(httpOrigin(undefined), null);
});

test("styles: inline allowed, with no nonce that would switch 'unsafe-inline' off", () => {
  const styles = parse(contentSecurityPolicy({ nonce: createNonce() })).get("style-src");
  assert.deepEqual(styles, ["'self'", "'unsafe-inline'"]);
});

test("images, workers and the rest of the policy", () => {
  const policy = parse(contentSecurityPolicy({ nonce: createNonce() }));
  assert.deepEqual(policy.get("img-src"), ["'self'", "data:", "blob:"]);
  assert.deepEqual(policy.get("worker-src"), ["blob:"]);
  assert.deepEqual(
    [...policy.keys()],
    [
      "default-src",
      "script-src",
      "style-src",
      "img-src",
      "connect-src",
      "worker-src",
      "object-src",
      "base-uri",
      "form-action",
      "frame-ancestors",
    ],
  );
});

test("every nonce is new: 16 random bytes, base64", () => {
  const nonces = Array.from({ length: 2000 }, createNonce);
  assert.equal(new Set(nonces).size, nonces.length);
  for (const nonce of nonces) {
    assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
    assert.equal(Buffer.from(nonce, "base64").length, 16);
  }
});

test("the Draco decoder <model-viewer> loads is the one the policy allows", () => {
  // The default decoder location of the installed @google/model-viewer: an
  // upgrade that moves it would break the /avatar models under the policy.
  const loading = readFileSync(
    new URL("node_modules/@google/model-viewer/lib/features/loading.js", web),
    "utf8",
  );
  const location = loading.match(/DEFAULT_DRACO_DECODER_LOCATION = '([^']+)'/)?.[1];
  assert.ok(location, "model-viewer's default Draco decoder location not found");
  assert.ok(location.startsWith(DRACO_DECODER_SOURCE), location);
});

test("the proxy sends the policy, and the layout puts the nonce on its inline scripts", () => {
  const proxy = readFileSync(new URL("proxy.ts", web), "utf8");
  assert.match(proxy, /request\.headers\.set\("x-nonce", nonce\)/);
  assert.match(proxy, /request\.headers\.set\("content-security-policy", policy\)/);
  assert.match(proxy, /response\.headers\.set\("content-security-policy", policy\)/);
  // The faucet the policy allows is the one /new calls, and so is the chain: the
  // proxy passes none, so the policy takes the RPC endpoints of core's `fuji`.
  const demo = readFileSync(new URL("app/[locale]/new/live-demo.tsx", web), "utf8");
  assert.match(demo, /FAUCET_URL = process\.env\.NEXT_PUBLIC_AVAKIT_FAUCET_URL/);
  assert.match(proxy, /faucetUrl: process\.env\.NEXT_PUBLIC_AVAKIT_FAUCET_URL/);
  assert.match(demo, /import \{ fuji \} from "@avakit\/core\/chains"/);
  assert.match(demo, /burnerAdapter\(\{ chain: fuji \}\)/);
  assert.doesNotMatch(proxy, /contentSecurityPolicy\(\{[^}]*\bchain\b/);

  const layout = readFileSync(new URL("app/[locale]/layout.tsx", web), "utf8");
  assert.match(layout, /\(await headers\(\)\)\.get\("x-nonce"\)/);
  assert.match(layout, /type="application\/ld\+json"\s+nonce=\{nonce\}/);
  assert.match(layout, /<ThemeProvider[^>]*\snonce=\{nonce\}/);
});
