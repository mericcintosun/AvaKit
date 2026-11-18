"use client";

import { motion } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useIsDesktop, usePrefersReducedMotion } from "@/components/use-media-query";
import { getContent, type Locale } from "@/lib/content";

const FADE = 0.7; // seconds

/** A calm, full-width topographic-terrain band that loops behind a statement. */
export function AmbientBand() {
  const c = getContent(useLocale() as Locale);
  const isDesktop = useIsDesktop();
  const reducedMotion = usePrefersReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);

  // The loop is decoration that moves for as long as the page is open, so it
  // needs a way to stop it (WCAG 2.2.2). Until the visitor uses the control it
  // plays, unless they asked for reduced motion; after that their choice wins.
  const [choice, setChoice] = useState<"play" | "pause" | null>(null);
  const wantsPlayback = choice ? choice === "play" : !reducedMotion;
  const shouldPlay = isDesktop && wantsPlayback;

  // Request the clip the first time it is about to play, then keep it. A
  // visitor who never plays it only ever gets the poster.
  const [load, setLoad] = useState(false);
  useEffect(() => {
    if (shouldPlay) setLoad(true);
  }, [shouldPlay]);

  // Mirrors the element rather than the intent: the fade below must only run
  // while frames are actually advancing.
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !load) return;
    if (!shouldPlay) {
      video.pause();
      return;
    }
    video.play().catch((error: unknown) => {
      // Autoplay refused: fall back to the poster and let the button offer Play
      // (the click then flips `shouldPlay`, which runs this again).
      if (error instanceof DOMException && error.name === "NotAllowedError") setChoice("pause");
    });
  }, [load, shouldPlay]);

  // Fade the loop in/out near its boundaries so the restart is seamless
  // (the terrain gently dissolves to black and re-emerges instead of jumping).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!playing) {
      // A still: the poster before any playback, the paused frame after. Show
      // it in full, unless the loop is about to start and fade itself in.
      if (!wantsPlayback) video.style.opacity = "1";
      return;
    }
    // Resuming from a visible still? Hold it at full opacity through the
    // opening fade window so playback doesn't dip to black first.
    let hold = video.style.opacity === "1";
    let raf = 0;
    const tick = () => {
      const duration = video.duration;
      if (duration && Number.isFinite(duration)) {
        const t = video.currentTime;
        if (t >= FADE) hold = false;
        const fadeIn = hold ? 1 : Math.min(1, t / FADE);
        const fadeOut = Math.min(1, (duration - t) / FADE);
        video.style.opacity = String(Math.max(0, Math.min(fadeIn, fadeOut)));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, wantsPlayback]);

  return (
    <section className="relative hidden h-[85vh] overflow-hidden bg-black md:block">
      {/* The picture is decoration; the statement and the control are not. */}
      <div aria-hidden="true" className="absolute inset-0">
        <video
          ref={videoRef}
          src={isDesktop && load ? "/illustration1-web.mp4" : undefined}
          poster="/illustration1-poster.jpg"
          muted
          loop
          playsInline
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          style={{ opacity: 0 }}
          className="absolute inset-0 h-full w-full object-cover invert"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="flex flex-col items-center gap-4 text-white"
        >
          <span className="font-mono text-xs tracking-[0.3em] text-white/60 uppercase">
            {c.ambient.eyebrow}
          </span>
          <p className="max-w-2xl text-3xl font-semibold tracking-tight text-balance lg:text-5xl">
            {c.ambient.statement}
          </p>
        </motion.div>
      </div>
      {/* `dark` scopes the tokens so the control reads on the always-dark band.
          Bottom-left keeps it clear of the floating feedback pill. */}
      <div className="dark absolute bottom-5 left-5 sm:left-8">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setChoice(wantsPlayback ? "pause" : "play")}
          aria-label={wantsPlayback ? "Pause background video" : "Play background video"}
          className="text-foreground bg-background/60 rounded-full backdrop-blur-sm"
        >
          {wantsPlayback ? <Pause /> : <Play />}
        </Button>
      </div>
    </section>
  );
}
