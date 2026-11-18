import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { Container } from "@/components/section";
import { TerminalDemo } from "@/components/terminal/terminal-demo";
import type { Locale } from "@/lib/content";
import { pageMetadata } from "@/lib/metadata";

// English only, like the demo itself: /tr/terminal canonicalizes to /terminal
// rather than presenting an English page as the Turkish translation.
export const metadata: Metadata = pageMetadata({
  route: "/terminal",
  title: "Terminal",
  description:
    "A replay of create-avalanche-app in a terminal: the questions it asks and the lines it prints while it scaffolds an Avalanche dapp.",
});

export default async function TerminalPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      {/* Subtle grid backdrop, matching the hero's aesthetic. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.035] dark:opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black, transparent 80%)",
        }}
      />
      <Container className="flex min-h-[70vh] max-w-3xl flex-col items-center justify-center">
        <TerminalDemo />
      </Container>
    </section>
  );
}
