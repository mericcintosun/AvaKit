import { AmbientBand } from "@/components/landing/ambient-band";
import { CinematicIntro } from "@/components/landing/cinematic-intro";
import { Hero } from "@/components/landing/hero";
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
      <AmbientBand />
      <TemplatesSection />
      <RecommenderSection />
      <McpSection />
      <FaqSection />
      <CtaSection />
    </>
  );
}
