import type { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { contentSecurityPolicy, createNonce } from "./lib/csp";

// Locale routing: English is served at "/", Turkish under "/tr". Next.js 16
// calls this file convention `proxy` (formerly `middleware`); next-intl still
// names its factory after the old one.
const handleI18nRouting = createMiddleware(routing);

// Every page also gets its Content-Security-Policy here, with a nonce made for
// this request alone (see lib/csp.ts). Set on the request, the policy is how
// Next.js learns the nonce and adds it to its own scripts while it renders, and
// `x-nonce` is how the layout reads it for the scripts it writes itself.
// next-intl forwards the request headers it is given, so both reach the render.
// Whatever a client sent in either header is overwritten.
export default function proxy(request: NextRequest) {
  const nonce = createNonce();
  const policy = contentSecurityPolicy({
    nonce,
    dev: process.env.NODE_ENV === "development",
    faucetUrl: process.env.NEXT_PUBLIC_AVAKIT_FAUCET_URL,
  });
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", policy);

  const response = handleI18nRouting(request);
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  // Run on everything except API, Next internals, files with an extension (so
  // /icon.png, /og-image.png, /robots.txt, /sitemap.xml are untouched), and the
  // metadata image routes Next generates without one: app/apple-icon.tsx is
  // served at /apple-icon, and localizing that path turns the touch icon into a
  // 404. The other generated names are listed so adding one can't repeat it.
  // What this skips gets no policy either. None of it is one of the site's
  // pages: a path with an extension that matches no file gets Next.js's built-in
  // 404, whose scripts have no nonce for a policy to allow.
  matcher: [
    "/((?!api|_next|_vercel|(?:icon|apple-icon|opengraph-image|twitter-image)(?:/|$)|.*\\..*).*)",
  ],
};
