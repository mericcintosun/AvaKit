"use client";

import { type MotionValue, motion, useInView, useScroll, useTransform } from "framer-motion";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";

import { useDataSaver } from "@/components/use-data-saver";
import { DESKTOP_QUERY, useIsDesktop, usePrefersReducedMotion } from "@/components/use-media-query";
import { cn } from "@/lib/utils";

const captionClass = "absolute flex max-w-3xl flex-col items-center gap-4 px-6 text-center";

/** A 1x1 transparent GIF: an image source that costs no request. */
const EMPTY_IMAGE = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

/**
 * Latches true on the visitor's first deliberate input: a real pointer move, a
 * press, a key, a wheel tick, a touch, or a scroll (which also covers a scroll
 * position the browser restored).
 */
function useHasInteracted(): boolean {
  const [interacted, setInteracted] = useState(false);
  useEffect(() => {
    if (window.scrollY > 0) {
      setInteracted(true);
      return;
    }
    const controller = new AbortController();
    const done = () => {
      setInteracted(true);
      controller.abort();
    };
    // A browser can re-send a move for a cursor that is only resting on the
    // page, so a move counts once the position actually changes.
    let at: { x: number; y: number } | null = null;
    const onMove = (event: PointerEvent) => {
      if (at && (at.x !== event.clientX || at.y !== event.clientY)) done();
      at = { x: event.clientX, y: event.clientY };
    };
    const options = { passive: true, signal: controller.signal };
    window.addEventListener("pointermove", onMove, options);
    for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) {
      window.addEventListener(type, done, options);
    }
    return () => controller.abort();
  }, []);
  return interacted;
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
  /** Override the <video> classes (e.g. to crop a baked-in watermark). The
   * poster is laid out with the same classes, directly under the video, so
   * they have to keep the two absolutely positioned. */
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
 *
 * The clip is large (every frame is a keyframe so it can be scrubbed), so it is
 * requested as late as it can be: only once the section is on screen and the
 * visitor has touched the page, and never while they are saving data. Until
 * then, and for anyone who never qualifies, the poster stands in.
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
  const dataSaver = useDataSaver();
  const interacted = useHasInteracted();
  const sectionRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const nearView = useInView(sectionRef, { margin: "200px" });

  // The scrub only runs at breakpoints that show the section, and only when
  // motion is welcome.
  const scrub = (!desktopOnly || isDesktop) && !reducedMotion;

  // Latched: once the clip has been requested it stays attached.
  const [load, setLoad] = useState(false);
  useEffect(() => {
    if (scrub && !dataSaver && nearView && interacted) setLoad(true);
  }, [scrub, dataSaver, nearView, interacted]);
  const active = scrub && load;

  // Whether the video element has a decoded frame of the clip to show.
  const [hasFrame, setHasFrame] = useState(false);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  useEffect(() => {
    const video = videoRef.current;
    // No frame loop while the section is off screen or has no clip to drive.
    if (!video || !active || !nearView) return;
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
  }, [active, nearView, scrollYProgress]);

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
          shift the video up by the header's height. `dark` scopes the tokens:
          this surface (and the captions on it) stays dark in both themes. */}
      <div className="dark bg-background sticky top-14 h-[calc(100dvh-3.5rem)] w-full overflow-hidden">
        {poster ? (
          // The poster is an image under the video rather than the video's own
          // `poster` attribute: a browser downloads that attribute even while
          // the section is `display: none` (desktopOnly, below md), whereas a
          // source scoped to the breakpoint is only fetched where it shows.
          <picture>
            {desktopOnly ? <source media={DESKTOP_QUERY} srcSet={poster} /> : null}
            <img
              src={desktopOnly ? EMPTY_IMAGE : poster}
              alt=""
              className={cn(videoClassName, "pointer-events-none select-none")}
            />
          </picture>
        ) : null}
        <video
          ref={videoRef}
          src={active ? src : undefined}
          muted
          playsInline
          // Scrubbing seeks all over the clip, so once it is wanted it has to
          // be buffered whole; `active` is what holds the request back.
          preload="auto"
          onLoadedData={() => {
            // Nudge to the first frame on load so the poster doesn't visibly
            // swap to a different frame on the first scroll.
            const v = videoRef.current;
            if (v && v.currentTime === 0) v.currentTime = 0.01;
            setHasFrame(true);
          }}
          // A new `src` empties the element until that clip has loaded.
          onEmptied={() => setHasFrame(false)}
          // With no frame to show the video is transparent, so the poster under
          // it is what is seen, whatever a browser paints for an empty video;
          // once it has one it covers the poster. Opacity rather than
          // `visibility`, so the element still counts as on screen to a
          // browser that holds back media it considers hidden.
          className={cn(videoClassName, !hasFrame && "opacity-0")}
        />
        <div className="from-background/50 via-background/25 to-background/60 pointer-events-none absolute inset-0 bg-gradient-to-b" />
        <div className="bg-background/10 pointer-events-none absolute inset-0" />
        <div className="text-foreground absolute inset-0 flex items-center justify-center">
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
