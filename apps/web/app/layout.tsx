import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type * as React from "react";

import { CommandMenu } from "@/components/command-menu";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { site } from "@/lib/content";
import "./globals.css";

const TITLE = "AvaKit — Open-source, AI-native Avalanche devtools";
const DESCRIPTION =
  "Avalanche's open-source, AI-native create-next-app: scaffold a social-login dapp, deploy-ready, with agent context baked in.";
const OG_IMAGE = {
  url: "/og-image.png",
  width: 1376,
  height: 768,
  alt: "AvaKit — Build. Deploy. Perfect.",
};

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

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: TITLE,
    template: "%s — AvaKit",
  },
  description: DESCRIPTION,
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
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "AvaKit",
    url: site.url,
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE.url],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static, non-user JSON-LD
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
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
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
