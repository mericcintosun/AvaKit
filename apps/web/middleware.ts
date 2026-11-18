import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Run on everything except API, Next internals, files with an extension (so
  // /icon.png, /og-image.png, /robots.txt, /sitemap.xml are untouched), and the
  // metadata image routes Next generates without one: app/apple-icon.tsx is
  // served at /apple-icon, and localizing that path turns the touch icon into a
  // 404. The other generated names are listed so adding one can't repeat it.
  matcher: [
    "/((?!api|_next|_vercel|(?:icon|apple-icon|opengraph-image|twitter-image)(?:/|$)|.*\\..*).*)",
  ],
};
