"use client";

import { type MotionValue, motion, useScroll, useTransform } from "framer-motion";
import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";

import { useIsDesktop, usePrefersReducedMotion } from "@/components/use-media-query";
import { cn } from "@/lib/utils";

const captionClass = "absolute flex max-w-3xl flex-col items-center gap-4 px-6 text-center";

function TimedCaption({
  progress,
  start,
  end,
  children,
}: {
  progress: MotionValue<number>;
  start: number;
  end: number;
  children: ReactNode;
}) {
  const fade = Math.max(0.04, (end - start) * 0.28);
  const opacity = useTransform(progress, [start, start + fade, end - fade, end], [0, 1, 1, 0]);
  const y = useTransform(progress, [start, start + fade], [24, 0]);
  return (
    <motion.div style={{ opacity, y }} className={captionClass}>
      {children}
    </motion.div>
  );
}

export interface ScrollVideoProps {
  /** All-keyframe, scrub-optimized mp4 (see the encode recipe in the docs). */
  src: string;
  poster?: string;
  /** Total scroll length of the pinned section, in viewport heights. */
  heightVh?: number;
  /** Captions revealed in sequence as you scroll. */
  captions?: ReactNode[];
  /** Extra classes for the section wrapper. */
  className?: string;
  /** Override the <video> classes (e.g. to crop a baked-in watermark). */
  videoClassName?: string;
  /** Desktop-only by default (avoids shipping a heavy video to phones). */
  desktopOnly?: boolean;
}

/**
 * A scroll-scrubbed background video: the clip's playhead is driven by scroll
 * position (eased with a rAF lerp for buttery smoothness) while captions fade
 * through in sequence. Reusable on any page — pass a video + captions.
 *
 * With "reduce motion" on there is no scrub: the section collapses from its
 * scroll runway to one screen showing the poster and the final caption, and the
 * clip is never requested.
 */
export function ScrollVideo({
  src,
  poster,
  heightVh = 300,
  captions = [],
  className,
  videoClassName = "absolute inset-0 h-full w-full object-cover",
  desktopOnly = true,
}: ScrollVideoProps) {
  const isDesktop = useIsDesktop();
  const reducedMotion = usePrefersReducedMotion();
  const sectionRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // The scrub only runs at breakpoints that show the section, and only when
  // motion is welcome.
  const scrub = (!desktopOnly || isDesktop) && !reducedMotion;

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !scrub) return;
    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const duration = video.duration;
      if (duration && Number.isFinite(duration) && video.readyState >= 1) {
        const target = Math.min(duration - 0.033, Math.max(0, scrollYProgress.get() * duration));
        const current = video.currentTime;
        const diff = target - current;
        if (Math.abs(diff) > 0.006) {
          try {
            video.currentTime = current + diff * 0.14;
          } catch {
            // seeking not ready yet
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [scrub, scrollYProgress]);

  const count = captions.length;
  const spanStart = 0.03;
  const spanEnd = 0.97;
  const seg = count > 0 ? (spanEnd - spanStart) / count : 0;

  return (
    <section
      ref={sectionRef}
      aria-hidden="true"
      style={{ "--scroll-video-height": `${heightVh}vh` } as CSSProperties}
      className={cn(
        // The height is a class (not an inline style) so the reduced-motion
        // override applies in CSS, before hydration, with no layout jump.
        "relative h-(--scroll-video-height) motion-reduce:h-auto",
        desktopOnly && "hidden md:block",
        className,
      )}
    >
      {/* Pin below the 56px (h-14) sticky header so the first scroll doesn't
          shift the video up by the header's height. */}
      <div className="sticky top-14 h-[calc(100dvh-3.5rem)] w-full overflow-hidden bg-black">
        <video
          ref={videoRef}
          src={scrub ? src : undefined}
          poster={poster}
          muted
          playsInline
          preload="auto"
          // Nudge to the first frame on load so the poster doesn't visibly swap
          // to a different frame on the first scroll.
          onLoadedData={() => {
            const v = videoRef.current;
            if (v && v.currentTime === 0) v.currentTime = 0.01;
          }}
          className={videoClassName}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-black/25 to-black/60" />
        <div className="pointer-events-none absolute inset-0 bg-black/10" />
        <div className="absolute inset-0 flex items-center justify-center text-white">
          {reducedMotion ? (
            // No scroll runway to pace the sequence, so show where it ends.
            <div className={captionClass}>{captions[count - 1]}</div>
          ) : (
            captions.map((caption, i) => (
              <TimedCaption
                // biome-ignore lint/suspicious/noArrayIndexKey: captions are a fixed ordered list
                key={i}
                progress={scrollYProgress}
                start={spanStart + i * seg}
                end={spanStart + (i + 1) * seg}
              >
                {caption}
              </TimedCaption>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
