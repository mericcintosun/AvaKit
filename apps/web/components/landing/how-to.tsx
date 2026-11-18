"use client";

import { useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Reveal } from "@/components/motion";
import { Container, Section, SectionHeading } from "@/components/section";
import { usePrefersReducedMotion } from "@/components/use-media-query";
import { getContent, type Locale, TUTORIAL_YOUTUBE_URL } from "@/lib/content";

/** "How to use" — a zero-to-dapp walkthrough. Plays a muted, silent preview of
 * the tutorial (public/avakittutorial.mp4) that only downloads once it scrolls
 * into view, so it never blocks the initial page load. The full, narrated
 * version links out to YouTube when TUTORIAL_YOUTUBE_URL is set.
 *
 * The preview starts by itself only when motion is welcome; otherwise the
 * poster and the native controls wait for the visitor to press play. */
export function HowToSection() {
  const c = getContent(useLocale() as Locale);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(false);
  const autoplay = !usePrefersReducedMotion();
  // Start it once; after that the visitor's own play/pause is left alone.
  const started = useRef(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !inView || !autoplay || started.current) return;
    started.current = true;
    video.play().catch(() => {
      // autoplay can be blocked; the poster + controls still work
    });
  }, [inView, autoplay]);

  return (
    <Section id="how-to-use">
      <Container>
        <SectionHeading eyebrow={c.howTo.eyebrow} title={c.howTo.title} lead={c.howTo.lead} />
        <Reveal className="mt-10">
          <div className="bg-muted/20 relative aspect-video w-full overflow-hidden rounded-xl border">
            <video
              ref={videoRef}
              src={inView ? "/avakittutorial.mp4" : undefined}
              poster="/avakittutorial-poster.jpg"
              muted
              loop
              playsInline
              controls
              preload="none"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
          {TUTORIAL_YOUTUBE_URL ? (
            <div className="mt-4 text-center">
              <a
                href={TUTORIAL_YOUTUBE_URL}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
              >
                {c.howTo.watchOnYoutube}
              </a>
            </div>
          ) : null}
        </Reveal>
      </Container>
    </Section>
  );
}
