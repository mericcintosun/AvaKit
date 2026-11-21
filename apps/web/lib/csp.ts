/**
 * The site's Content-Security-Policy. proxy.ts builds it for every page request
 * with a fresh nonce, and sends it with the response.
 *
 * Why the site has one: /new keeps a temporary wallet whose private key sits in
 * localStorage in the clear, and it signs Fuji transactions with one click. Any
 * script that runs on this origin can read that key, so the policy decides which
 * scripts run: only those that carry this response's nonce (Next.js adds it to
 * its own scripts; the layout adds it to the theme script and the JSON-LD block),
 * plus whatever those scripts load themselves ('strict-dynamic'). An injected
 * `<script>` or inline event handler has no nonce and does not run.
 *
 * The policy is the same on every page. A client-side navigation keeps the
 * policy of the page the visitor landed on, so a page cannot have a policy of
 * its own: what /avatar needs has to be allowed on the home page too.
 *
 * Its only import is the chain list, which imports nothing itself, so
 * test/csp.test.mjs loads this module with plain Node.
 */
import { fuji } from "@avakit/core/chains";

/**
 * Where <model-viewer> fetches the Draco decoder for the compressed /avatar
 * models (its default decoder location). The decoder is a WebAssembly module
 * that runs in a worker made from a blob: URL, hence 'wasm-unsafe-eval' and
 * `worker-src blob:` below.
 */
export const DRACO_DECODER_SOURCE = "https://www.gstatic.com/draco/";

/** 16 random bytes, base64: unguessable, and in the form Next.js reads from the header. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** The origin of an http(s) URL, or null for anything else (unset, malformed, another scheme). */
export function httpOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const { protocol, origin } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? origin : null;
  } catch {
    return null;
  }
}

export interface PolicyOptions {
  /** This response's nonce, from createNonce(). */
  nonce: string;
  /** `next dev`: React's development build uses eval to rebuild server error stacks. */
  dev?: boolean;
  /** The faucet /new asks for test AVAX: NEXT_PUBLIC_AVAKIT_FAUCET_URL, when the deploy sets it. */
  faucetUrl?: string;
}

/** The header value for one response. */
export function contentSecurityPolicy({ nonce, dev = false, faucetUrl }: PolicyOptions): string {
  const directives: Record<string, (string | null)[]> = {
    // Everything not listed below comes from the site itself: the fonts
    // (next/font serves Geist from the site), the videos, the web app manifest,
    // and frames (the site embeds none).
    "default-src": ["'self'"],
    // Next.js takes the nonce from the first directive whose name starts with
    // "script-src", so this one stays ahead of any script-src-elem or
    // script-src-attr. 'self' is for browsers that predate 'strict-dynamic':
    // they ignore it and fall back to the site's own scripts.
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "'wasm-unsafe-eval'",
      dev ? "'unsafe-eval'" : null,
    ],
    // 'unsafe-inline' cannot be avoided here: React server-renders every `style`
    // prop as a style="" attribute (Framer Motion's first frames, next/image's
    // `color:transparent`, the /avatar gradients), and a nonce cannot go on an
    // attribute. Radix's scroll lock and next-themes add <style> elements while
    // the page runs, too. A style changes how the page looks; it cannot run a
    // script or read localStorage, which is what script-src protects.
    "style-src": ["'self'", "'unsafe-inline'"],
    // data: is the art of the NFT /new mints (an SVG data URI read from the
    // contract) and the empty placeholder the home page shows on phones. blob:
    // is the textures <model-viewer> unpacks from a .glb, in the browsers where
    // three.js decodes them with an <img> (Safari before 17, Firefox before 98).
    "img-src": ["'self'", "data:", "blob:"],
    // What the browser calls besides the site: the Fuji RPC behind /new's wallet
    // and balance reads, the AvaKit faucet, the Draco decoder, and the blob: URLs
    // three.js fetches those textures from in every other browser. /stats reads
    // npm, GitHub and the telemetry collector on the server, where no policy
    // applies.
    "connect-src": [
      "'self'",
      httpOrigin(fuji.rpcUrl),
      httpOrigin(faucetUrl),
      DRACO_DECODER_SOURCE,
      "blob:",
    ],
    "worker-src": ["blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    // The same rule as the X-Frame-Options header in next.config.ts: /new signs
    // transactions with one click, so no other site may frame the pages.
    "frame-ancestors": ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => [name, ...new Set(sources.filter((s) => s !== null))].join(" "))
    .join("; ");
}
