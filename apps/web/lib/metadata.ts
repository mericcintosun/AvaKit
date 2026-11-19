import type { Metadata } from "next";

import { routing } from "@/i18n/routing";
import type { Locale } from "@/lib/content";
import { OG_IMAGE } from "@/lib/og-image";

/**
 * Per-page metadata, built in one place.
 *
 * Next.js merges metadata shallowly: a page that sets no `alternates` or
 * `openGraph` inherits its layout's whole, and one that sets `openGraph`
 * replaces it whole. Canonical, hreflang and og:url are facts about a single
 * URL, so a value set in the layout is wrong for every page below it (it made
 * /new, /avatar and /pitch canonicalize to the home page, and every page share
 * the home page's og:url and title). Each page builds them here instead, from
 * its own route.
 */

export const SITE_NAME = "AvaKit";

/** `withSiteName("%s")` is the layout's title template; social cards get the same suffix. */
export const withSiteName = (title: string) => `${title} — ${SITE_NAME}`;

/** The home page leads with the site name instead: "AvaKit — <tagline>". */
export const homeTitle = (tagline: string) => `${SITE_NAME} — ${tagline}`;

export { OG_IMAGE };

const OG_LOCALE: Record<Locale, string> = { en: "en_US", tr: "tr_TR" };

/** Where `route` lives for a locale: English at "/x", Turkish at "/tr/x". */
function localizedPath(locale: Locale, route: string) {
  return `${locale === routing.defaultLocale ? "" : `/${locale}`}${route}` || "/";
}

interface PageMetadataInput {
  /** The page's route without a locale prefix: "" for the home page, "/docs/mcp", … */
  route: string;
  /** The page title. The site name is appended unless `absoluteTitle` is set. */
  title: string;
  description: string;
  /**
   * The locale being rendered, for a page whose content is translated. Leave it
   * out for a page that exists in English only: whichever locale prefix it is
   * served under, it then canonicalizes to the English URL and declares no
   * hreflang alternates, so the Turkish URL is never offered as a translation.
   */
  locale?: Locale;
  /** For the home page, whose title already carries the site name. */
  absoluteTitle?: boolean;
}

export function pageMetadata({
  route,
  title,
  description,
  locale,
  absoluteTitle = false,
}: PageMetadataInput): Metadata {
  const fullTitle = absoluteTitle ? title : withSiteName(title);
  // Relative URLs: Next.js resolves them against the layout's `metadataBase`.
  const url = localizedPath(locale ?? routing.defaultLocale, route);
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: {
      canonical: url,
      ...(locale
        ? {
            languages: {
              ...Object.fromEntries(routing.locales.map((l) => [l, localizedPath(l, route)])),
              "x-default": localizedPath(routing.defaultLocale, route),
            },
          }
        : {}),
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      url,
      title: fullTitle,
      description,
      locale: OG_LOCALE[locale ?? routing.defaultLocale],
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [OG_IMAGE.url],
    },
  };
}
