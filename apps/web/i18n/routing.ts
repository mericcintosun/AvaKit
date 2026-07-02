import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "tr"],
  defaultLocale: "en",
  // English stays at "/"; Turkish is served under "/tr".
  localePrefix: "as-needed",
});
