"use client";

import Image from "next/image";
import { useLocale } from "next-intl";

import { ScrollVideo } from "@/components/scroll-video";
import { getContent, type Locale } from "@/lib/content";

/** The homepage cinematic opener — a reusable <ScrollVideo> with AvaKit copy. */
export function CinematicIntro() {
  const c = getContent(useLocale() as Locale);
  return (
    <ScrollVideo
      src="/mountain-scrub.mp4"
      poster="/mountain-poster.jpg"
      heightVh={300}
      captions={[
        <p
          key="c1"
          className="text-5xl font-semibold tracking-[-0.02em] text-balance lg:text-7xl lg:leading-[0.95]"
        >
          {c.cinematic.line1}
        </p>,
        <p
          key="c2"
          className="text-5xl font-semibold tracking-[-0.02em] text-balance lg:text-7xl lg:leading-[0.95]"
        >
          {c.cinematic.line2}
        </p>,
        <div key="c3" className="flex flex-col items-center gap-4">
          <Image
            src="/logo.png"
            alt=""
            width={582}
            height={653}
            className="mb-2 h-16 w-auto invert lg:h-20"
          />
          <span className="font-mono text-sm tracking-[0.3em] text-white/60 uppercase">
            {c.cinematic.introducing}
          </span>
          <span className="text-6xl font-semibold tracking-tight lg:text-8xl">AvaKit</span>
          <span className="max-w-md text-base text-balance text-white/70 lg:text-lg">
            {c.footer.tagline}
          </span>
        </div>,
      ]}
    />
  );
}
