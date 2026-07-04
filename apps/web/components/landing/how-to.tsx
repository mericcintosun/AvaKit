"use client";

import { Play } from "lucide-react";
import { useLocale } from "next-intl";

import { Reveal } from "@/components/motion";
import { Container, Section, SectionHeading } from "@/components/section";
import { getContent, type Locale, TUTORIAL_VIDEO_ID } from "@/lib/content";

/** "How to use" — a zero-to-dapp walkthrough video for first-time users.
 * Shows the embedded video when NEXT_PUBLIC_TUTORIAL_VIDEO_ID is set, otherwise
 * a styled placeholder. Deliberately has no buttons/links — just the video. */
export function HowToSection() {
  const c = getContent(useLocale() as Locale);
  return (
    <Section id="how-to-use">
      <Container>
        <SectionHeading eyebrow={c.howTo.eyebrow} title={c.howTo.title} lead={c.howTo.lead} />
        <Reveal className="mt-10">
          <div className="bg-muted/20 relative aspect-video w-full overflow-hidden rounded-xl border">
            {TUTORIAL_VIDEO_ID ? (
              <iframe
                className="absolute inset-0 h-full w-full"
                src={`https://www.youtube-nocookie.com/embed/${TUTORIAL_VIDEO_ID}`}
                title={c.howTo.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <div className="border-primary/30 bg-primary/10 text-primary flex size-16 items-center justify-center rounded-full border">
                  <Play className="size-6 fill-current" />
                </div>
                <span className="text-muted-foreground font-mono text-xs tracking-[0.2em] uppercase">
                  {c.howTo.placeholder}
                </span>
              </div>
            )}
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
