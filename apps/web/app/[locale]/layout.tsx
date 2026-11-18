import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import type * as React from "react";

import { CommandMenu } from "@/components/command-menu";
import { FeedbackButton } from "@/components/feedback-button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routing } from "@/i18n/routing";
import { getContent, type Locale, site } from "@/lib/content";
import { homeTitle, OG_IMAGE, withSiteName } from "@/lib/metadata";
import "../globals.css";

const DESCRIPTION =
  "An open-source, AI-native create-next-app for Avalanche: scaffold a working dapp with a temporary test wallet, social login and browser wallets, and agent context baked in.";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${site.url}/#website`,
      url: site.url,
      name: "AvaKit",
      description: DESCRIPTION,
    },
    {
      "@type": "SoftwareApplication",
      name: "AvaKit",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Node.js",
      url: site.url,
      description: DESCRIPTION,
      license: "https://opensource.org/licenses/MIT",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  ],
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const c = getContent((hasLocale(routing.locales, locale) ? locale : "en") as Locale);
  const title = homeTitle(c.site.tagline);
  return {
    metadataBase: new URL(site.url),
    title: { default: title, template: withSiteName("%s") },
    description: c.site.description,
    applicationName: "AvaKit",
    keywords: [
      "Avalanche",
      "AvaKit",
      "create-avalanche-app",
      "web3",
      "dapp",
      "viem",
      "Web3Auth",
      "MCP",
      "Foundry",
      "Fuji",
      "Avalanche L1",
      "ICM",
      "AI-native",
      "scaffold",
    ],
    authors: [{ name: "AvaKit contributors" }],
    creator: "AvaKit",
    // Site-wide defaults only. Canonical, hreflang and og:url describe a single
    // URL, and anything set here is inherited by every page below, so each page
    // builds its own with pageMetadata() from lib/metadata.ts.
    openGraph: {
      type: "website",
      siteName: "AvaKit",
      title,
      description: c.site.description,
      locale: locale === "tr" ? "tr_TR" : "en_US",
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: c.site.description,
      images: [OG_IMAGE.url],
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
  ],
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static, non-user JSON-LD
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <TooltipProvider>
              <div className="flex min-h-dvh flex-col">
                <SiteHeader />
                <main className="flex-1">{children}</main>
                <SiteFooter />
              </div>
              <CommandMenu />
              <FeedbackButton />
            </TooltipProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
