"use client";

import { motion } from "framer-motion";
import { Box, Gem, Hand, MousePointer2, Rotate3d, Sparkles } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";

import { Link } from "@/i18n/navigation";

/* AvaKit 3D mascots — a standalone showcase page for the two branded assets:
   the AvaFox mascot and the Obsidian Core. Interactive glTF (Draco) rendered
   with <model-viewer>, imported from npm client-side and code-split to this
   page, so there is no external CDN at runtime. The root is forced `dark` so all
   colors resolve from the design tokens in globals.css (Ember Crimson =
   --primary / --brand) — no colors are hardcoded here. Each model ships a baked,
   seamless 6s idle clip. */

// <model-viewer> is a custom element; cast the tag so JSX/TS accept its attrs.
const ModelViewer = "model-viewer" as unknown as React.FC<
  React.HTMLAttributes<HTMLElement> & Record<string, unknown>
>;

const ASSETS = [
  {
    key: "fox",
    label: "AvaFox",
    icon: Sparkles,
    src: "/3d/fox.glb",
    poster: "/3d/fox-hero.png",
    clip: "FoxIdle",
    alt: "AvaFox — sitting fox mascot with warm amber eyes",
    title: "AvaFox",
    blurb:
      "The AvaKit mascot — charcoal & white fur with warm amber eyes. Idle loop: breathing, tail sway, ear twitches and a gentle turn.",
    specs: [
      { icon: Box, label: "25,252 tris" },
      { icon: Rotate3d, label: "FoxIdle · 6s loop" },
      { icon: MousePointer2, label: "Draco · 882 KB" },
    ],
    orbit: { min: "auto 65deg auto", max: "auto 95deg auto" },
  },
  {
    key: "core",
    label: "Obsidian Core",
    icon: Gem,
    src: "/3d/core.glb",
    poster: "/3d/core-hero.png",
    clip: "CoreIdle",
    alt: "Obsidian Core — faceted glass sphere with a glowing ember heart and orbiting shards",
    title: "Obsidian Core",
    blurb:
      "A faceted obsidian-glass sphere with a vivid ember heart, glowing visor slit, etched triangle mark and slowly orbiting shards.",
    specs: [
      { icon: Box, label: "1,414 tris" },
      { icon: Rotate3d, label: "CoreIdle · 6s loop" },
      { icon: MousePointer2, label: "Draco · 77 KB" },
    ],
    orbit: { min: "auto 55deg auto", max: "auto 110deg auto" },
  },
] as const;

type Asset = (typeof ASSETS)[number];

const fade = {
  hidden: { opacity: 0, y: 20 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

/**
 * Register the <model-viewer> custom element. The import is client-side only
 * (it touches `window` and defines a custom element, so it must not run during
 * SSR) and dynamic, so the ~1 MB viewer is code-split to this page alone.
 */
function useModelViewer() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (customElements.get("model-viewer")) {
      setReady(true);
      return;
    }
    void import("@google/model-viewer").then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}

const embedSnippet = (a: Asset) => `<model-viewer
  src="${a.src}"
  poster="${a.poster}"
  autoplay animation-name="${a.clip}"
  camera-controls environment-image="neutral"
  shadow-intensity="0" exposure="1"
  alt="${a.title}">
</model-viewer>`;

export default function AvatarPage() {
  const ready = useModelViewer();
  const [active, setActive] = useState<Asset>(ASSETS[0]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(embedSnippet(active));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <main
      className="dark bg-background text-foreground relative min-h-dvh w-full overflow-hidden"
      style={{
        backgroundImage:
          "radial-gradient(120% 90% at 50% 20%, var(--card) 0%, var(--background) 70%)",
      }}
    >
      {/* ambient crimson glow, sourced from the brand token */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(40% 35% at 72% 40%, color-mix(in oklch, var(--brand) 20%, transparent) 0%, transparent 60%)",
        }}
      />

      <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-6 py-20 sm:px-10 lg:grid-cols-2 lg:gap-8 lg:py-28">
        {/* ── Left: interactive 3D ── */}
        <motion.div variants={fade} initial="hidden" animate="show" className="order-2 lg:order-1">
          <div
            className="border-border bg-card relative aspect-square w-full overflow-hidden rounded-3xl border"
            style={{
              boxShadow:
                "0 30px 80px -20px color-mix(in oklch, var(--background) 90%, black), inset 0 0 120px color-mix(in oklch, var(--brand) 6%, transparent)",
            }}
          >
            <ModelViewer
              key={active.key}
              src={active.src}
              poster={active.poster}
              alt={active.alt}
              autoplay=""
              animation-name={active.clip}
              camera-controls=""
              touch-action="pan-y"
              interaction-prompt="none"
              environment-image="neutral"
              shadow-intensity="0"
              exposure="1.05"
              min-camera-orbit={active.orbit.min}
              max-camera-orbit={active.orbit.max}
              style={{ width: "100%", height: "100%", backgroundColor: "transparent" }}
            />

            {/* drag hint */}
            <div className="border-border bg-background/50 text-muted-foreground pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] backdrop-blur">
              <Hand className="h-3.5 w-3.5" />
              {ready ? "Drag to orbit" : "Loading 3D…"}
            </div>
          </div>
        </motion.div>

        {/* ── Right: copy + meta + embed ── */}
        <div className="order-1 flex flex-col gap-6 lg:order-2">
          <motion.div variants={fade} custom={0} initial="hidden" animate="show">
            <span className="border-primary/35 text-primary inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] tracking-[0.2em] uppercase">
              <Sparkles className="h-3.5 w-3.5" />
              Avalanche · AvaKit
            </span>
          </motion.div>

          {/* asset switcher */}
          <motion.div
            variants={fade}
            custom={1}
            initial="hidden"
            animate="show"
            className="flex gap-2"
          >
            {ASSETS.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => setActive(a)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${
                  active.key === a.key
                    ? "border-primary/50 text-primary bg-primary/10"
                    : "border-border text-muted-foreground hover:bg-foreground/5"
                }`}
              >
                <a.icon className="h-4 w-4" />
                {a.label}
              </button>
            ))}
          </motion.div>

          <motion.h1
            key={`title-${active.key}`}
            variants={fade}
            custom={2}
            initial="hidden"
            animate="show"
            className="text-4xl font-semibold tracking-tight sm:text-5xl"
          >
            Meet <span className="text-primary">{active.title}</span>
          </motion.h1>

          <motion.p
            key={`blurb-${active.key}`}
            variants={fade}
            custom={3}
            initial="hidden"
            animate="show"
            className="text-muted-foreground max-w-md text-base leading-relaxed"
          >
            {active.blurb} glTF&nbsp;2.0, web-ready for{" "}
            <code className="bg-foreground/10 rounded px-1 py-0.5 text-[13px]">model-viewer</code>{" "}
            or Three.js.
          </motion.p>

          {/* spec chips */}
          <motion.div
            key={`specs-${active.key}`}
            variants={fade}
            custom={4}
            initial="hidden"
            animate="show"
            className="flex flex-wrap gap-2"
          >
            {active.specs.map((s) => (
              <span
                key={s.label}
                className="border-border bg-foreground/5 text-muted-foreground inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs"
              >
                <s.icon className="text-primary h-3.5 w-3.5" />
                {s.label}
              </span>
            ))}
          </motion.div>

          {/* embed snippet */}
          <motion.div variants={fade} custom={5} initial="hidden" animate="show" className="mt-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-muted-foreground font-mono text-[11px] tracking-wide uppercase">
                Embed
              </span>
              <button
                type="button"
                onClick={copy}
                className="border-border bg-foreground/5 text-muted-foreground hover:bg-foreground/10 rounded-md border px-2.5 py-1 text-xs transition"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <pre className="border-border bg-background/70 text-muted-foreground overflow-x-auto rounded-xl border p-4 font-mono text-[12px] leading-relaxed">
              {embedSnippet(active)}
            </pre>
          </motion.div>

          <motion.div
            variants={fade}
            custom={6}
            initial="hidden"
            animate="show"
            className="flex items-center gap-4 text-sm"
          >
            <a
              href={active.src}
              download
              className="text-primary inline-flex items-center gap-1.5 font-medium transition hover:opacity-80"
            >
              <Box className="h-4 w-4" />
              Download .glb
            </a>
            <Link href="/" className="text-muted-foreground hover:text-foreground transition">
              ← Back home
            </Link>
          </motion.div>
        </div>
      </div>
    </main>
  );
}
