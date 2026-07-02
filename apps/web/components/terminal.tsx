"use client";

import { motion } from "framer-motion";
import { useLocale } from "next-intl";
import type { ReactNode } from "react";

import { getContent, type Locale } from "@/lib/content";
import { cn } from "@/lib/utils";

export function Terminal({ className }: { className?: string }) {
  const t = getContent(useLocale() as Locale).hero.terminal;
  const lines: { text: ReactNode; muted?: boolean }[] = [
    {
      text: (
        <>
          <span className="text-primary select-none">$ </span>npm create avalanche-app@latest my-app
        </>
      ),
    },
    { text: `◆  ${t[0]}`, muted: true },
    { text: `◆  ${t[1]}`, muted: true },
    { text: `◆  ${t[2]}`, muted: true },
    {
      text: (
        <>
          <span className="text-primary">✓</span> {t[3]}
        </>
      ),
    },
    {
      text: (
        <>
          <span className="text-primary">✓</span> {t[4]}
        </>
      ),
    },
    { text: `→  ${t[5]}`, muted: true },
    {
      text: (
        <>
          <span className="text-muted-foreground">▸ </span>
          {t[6]}
        </>
      ),
    },
  ];

  return (
    <div
      className={cn(
        "bg-muted/30 overflow-hidden rounded-xl border font-mono text-[13px] shadow-sm",
        className,
      )}
    >
      <div className="bg-muted/50 flex items-center gap-2 border-b px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="border-foreground/20 size-2.5 rounded-full border" />
          <span className="border-foreground/20 size-2.5 rounded-full border" />
          <span className="border-foreground/20 size-2.5 rounded-full border" />
        </div>
        <span className="text-muted-foreground ml-1 text-xs">bash — my-app</span>
      </div>
      <motion.div
        className="flex flex-col gap-1.5 p-4 leading-relaxed"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true }}
        variants={{ show: { transition: { staggerChildren: 0.12, delayChildren: 0.15 } } }}
      >
        {lines.map((line, i) => (
          <motion.div
            // biome-ignore lint/suspicious/noArrayIndexKey: terminal lines are static and ordered
            key={i}
            variants={{ hidden: { opacity: 0, x: -6 }, show: { opacity: 1, x: 0 } }}
            className={cn("whitespace-pre-wrap", line.muted && "text-muted-foreground")}
          >
            {line.text}
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
