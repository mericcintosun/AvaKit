import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "tr"],
  defaultLocale: "en",
  // English stays at "/"; Turkish is served under "/tr".
  localePrefix: "as-needed",
  // No automatic hreflang `Link` header: it would announce a Turkish version of
  // every path, and most pages (docs, /new, /stats, …) exist in English only.
  // The pages that are translated declare their alternates themselves, through
  // pageMetadata() in lib/metadata.ts.
  alternateLinks: false,
});
