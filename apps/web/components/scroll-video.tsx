"use client";

import { type MotionValue, motion, useScroll, useTransform } from "framer-motion";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** True on >=768px — the video is rendered + loaded on desktop only. */
function useIsDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

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
    <motion.div
      style={{ opacity, y }}
      className="absolute flex max-w-3xl flex-col items-center gap-4 px-6 text-center"
    >
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
  /** Desktop-only by default (avoids shipping a heavy video to phones). */
  desktopOnly?: boolean;
}

/**
 * A scroll-scrubbed background video: the clip's playhead is driven by scroll
 * position (eased with a rAF lerp for buttery smoothness) while captions fade
 * through in sequence. Reusable on any page — pass a video + captions.
 */
export function ScrollVideo({
  src,
  poster,
  heightVh = 300,
  captions = [],
  className,
  desktopOnly = true,
}: ScrollVideoProps) {
  const isDesktop = useIsDesktop();
  const sectionRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
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
  }, [scrollYProgress]);

  const count = captions.length;
  const spanStart = 0.03;
  const spanEnd = 0.97;
  const seg = count > 0 ? (spanEnd - spanStart) / count : 0;

  return (
    <section
      ref={sectionRef}
      aria-hidden="true"
      style={{ height: `${heightVh}vh` }}
      className={cn("relative", desktopOnly && "hidden md:block", className)}
    >
      <div className="sticky top-0 h-screen w-full overflow-hidden bg-black">
        <video
          ref={videoRef}
          src={!desktopOnly || isDesktop ? src : undefined}
          poster={poster}
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-black/25 to-black/60" />
        <div className="pointer-events-none absolute inset-0 bg-black/10" />
        <div className="absolute inset-0 flex items-center justify-center text-white">
          {captions.map((caption, i) => (
            <TimedCaption
              // biome-ignore lint/suspicious/noArrayIndexKey: captions are a fixed ordered list
              key={i}
              progress={scrollYProgress}
              start={spanStart + i * seg}
              end={spanStart + (i + 1) * seg}
            >
              {caption}
            </TimedCaption>
          ))}
        </div>
      </div>
    </section>
  );
}
