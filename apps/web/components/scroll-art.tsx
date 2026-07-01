"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import Image from "next/image";
import { useRef } from "react";

import { cn } from "@/lib/utils";

export interface ScrollArtProps {
  src: string;
  alt?: string;
  width: number;
  height: number;
  className?: string;
  imgClassName?: string;
  /** Vertical parallax travel in px across the scroll range (0 disables it). */
  parallax?: number;
  /** Fade + zoom in as it enters the viewport. */
  reveal?: boolean;
  /** Auto-invert the black line art in dark mode. */
  invertOnDark?: boolean;
  priority?: boolean;
}

/**
 * Scroll-reactive illustration for static images: gentle parallax drift plus a
 * fade/zoom reveal as it passes through the viewport. Reusable anywhere — the
 * PNG counterpart to <ScrollVideo>.
 */
export function ScrollArt({
  src,
  alt = "",
  width,
  height,
  className,
  imgClassName,
  parallax = 40,
  reveal = true,
  invertOnDark = true,
  priority = false,
}: ScrollArtProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  const y = useTransform(scrollYProgress, [0, 1], [parallax, -parallax]);
  const opacity = useTransform(scrollYProgress, [0, 0.22], reveal ? [0, 1] : [1, 1]);
  const scale = useTransform(scrollYProgress, [0, 0.3], reveal ? [0.94, 1] : [1, 1]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <motion.div style={{ y, opacity, scale }}>
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          priority={priority}
          className={cn("h-auto w-full", invertOnDark && "dark:invert", imgClassName)}
        />
      </motion.div>
    </div>
  );
}
