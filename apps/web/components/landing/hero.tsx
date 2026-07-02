"use client";

import { motion, type Variants } from "framer-motion";
import { ArrowRight, Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Container } from "@/components/section";
import { Terminal } from "@/components/terminal";
import { Button } from "@/components/ui/button";
import { site } from "@/lib/content";

const container: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "easeOut" } },
};

function CopyPill() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(site.createCommand).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
      className="bg-muted/40 hover:bg-muted inline-flex items-center gap-3 rounded-full border py-1.5 pr-2 pl-4 font-mono text-xs transition-colors sm:text-sm"
    >
      <span>
        <span className="text-primary select-none">$ </span>
        {site.createCommand}
      </span>
      <span className="bg-background flex size-6 items-center justify-center rounded-full border">
        {copied ? <Check className="size-3" /> : <Copy className="text-muted-foreground size-3" />}
      </span>
    </button>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.035] dark:opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black, transparent 80%)",
        }}
      />
      <Container>
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="grid items-center gap-12 py-20 sm:py-28 lg:grid-cols-[1.05fr_0.95fr]"
        >
          <div className="flex flex-col items-start gap-6">
            <motion.span
              variants={item}
              className="text-muted-foreground inline-flex items-center gap-2 font-mono text-xs tracking-[0.2em] uppercase"
            >
              <span className="bg-primary inline-block size-1.5 rounded-full" />
              Open source · AI-native · MIT
            </motion.span>
            <motion.h1
              variants={item}
              className="text-5xl font-semibold tracking-[-0.03em] text-balance sm:text-6xl lg:text-[5rem] lg:leading-[0.95]"
            >
              The developer toolkit for building on{" "}
              <span className="decoration-primary underline decoration-2 underline-offset-[8px]">
                Avalanche
              </span>
              .
            </motion.h1>
            <motion.p
              variants={item}
              className="text-muted-foreground max-w-lg text-lg leading-relaxed text-pretty"
            >
              {site.description}
            </motion.p>
            <motion.div variants={item} className="flex flex-wrap items-center gap-3 pt-1">
              <Button asChild size="lg">
                <Link href="/docs">
                  Get started
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/templates">Browse templates</Link>
              </Button>
            </motion.div>
            <motion.div variants={item}>
              <CopyPill />
            </motion.div>
          </div>

          <motion.div variants={item} className="lg:pl-4">
            <Terminal />
          </motion.div>
        </motion.div>
      </Container>
    </section>
  );
}
