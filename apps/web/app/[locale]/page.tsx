import type { Metadata } from "next";

import { AmbientBand } from "@/components/landing/ambient-band";
import { CinematicIntro } from "@/components/landing/cinematic-intro";
import { Hero } from "@/components/landing/hero";
import { HowToSection } from "@/components/landing/how-to";
import { DifferentiationSection, WhoForSection } from "@/components/landing/positioning";
import { RecommenderSection } from "@/components/landing/recommender";
import {
  CtaSection,
  FaqSection,
  FeaturesSection,
  McpSection,
  StepsSection,
  SurfacesSection,
  TemplatesSection,
} from "@/components/landing/sections";
import { getContent, type Locale } from "@/lib/content";
import { homeTitle, pageMetadata } from "@/lib/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const c = getContent(locale);
  return pageMetadata({
    locale,
    route: "",
    title: homeTitle(c.site.tagline),
    description: c.site.description,
    absoluteTitle: true,
  });
}

export default function Home() {
  return (
    <>
      <CinematicIntro />
      <Hero />
      <SurfacesSection />
      <FeaturesSection />
      <DifferentiationSection />
      <WhoForSection />
      <StepsSection />
      <HowToSection />
      <AmbientBand />
      <TemplatesSection />
      <RecommenderSection />
      <McpSection />
      <FaqSection />
      <CtaSection />
    </>
  );
}
