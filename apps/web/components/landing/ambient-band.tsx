"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

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

/** A calm, full-width topographic-terrain band that loops behind a statement. */
export function AmbientBand() {
  const isDesktop = useIsDesktop();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Fade the loop in/out near its boundaries so the restart is seamless
  // (the terrain gently dissolves to black and re-emerges instead of jumping).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isDesktop) return;
    const FADE = 0.7; // seconds
    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const duration = video.duration;
      if (duration && Number.isFinite(duration)) {
        const t = video.currentTime;
        const fadeIn = Math.min(1, t / FADE);
        const fadeOut = Math.min(1, (duration - t) / FADE);
        video.style.opacity = String(Math.max(0, Math.min(fadeIn, fadeOut)));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [isDesktop]);

  return (
    <section
      aria-hidden="true"
      className="relative hidden h-[85vh] overflow-hidden bg-black md:block"
    >
      <video
        ref={videoRef}
        src={isDesktop ? "/illustration1-web.mp4" : undefined}
        poster="/illustration1-poster.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        style={{ opacity: 0 }}
        className="absolute inset-0 h-full w-full object-cover invert"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70" />
      <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="flex flex-col items-center gap-4 text-white"
        >
          <span className="font-mono text-xs tracking-[0.3em] text-white/60 uppercase">
            One toolkit, every surface
          </span>
          <p className="max-w-2xl text-3xl font-semibold tracking-tight text-balance lg:text-5xl">
            Wallets, contracts, and AI — on one consistent core.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
