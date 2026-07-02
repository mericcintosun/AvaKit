import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Run on everything except API, Next internals, and files with an extension
  // (so /icon.png, /og-image.png, /robots.txt, /sitemap.xml are untouched).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
