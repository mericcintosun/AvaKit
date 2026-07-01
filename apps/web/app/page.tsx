import { AmbientBand } from "@/components/landing/ambient-band";
import { CinematicIntro } from "@/components/landing/cinematic-intro";
import { Hero } from "@/components/landing/hero";
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
      <StepsSection />
      <AmbientBand />
      <TemplatesSection />
      <McpSection />
      <FaqSection />
      <CtaSection />
    </>
  );
}
