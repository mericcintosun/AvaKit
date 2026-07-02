"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";

import { CodeBlock } from "@/components/code-block";
import { fadeUp, Reveal, RevealGroup } from "@/components/motion";
import { Container, Eyebrow, Section, SectionHeading } from "@/components/section";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { faqs, features, mcpTools, steps, surfaces, templates } from "@/lib/content";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n + 1).padStart(2, "0");

/* ── Surfaces: bento grid ─────────────────────────────────────────────── */
export function SurfacesSection() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const bgY = useTransform(scrollYProgress, [0, 1], [-50, 50]);

  return (
    <Section id="architecture">
      <div ref={ref} className="relative">
        <motion.div
          aria-hidden="true"
          style={{ y: bgY }}
          className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 flex -translate-y-1/2 justify-center opacity-[0.05] dark:opacity-[0.09]"
        >
          <div className="relative aspect-[982/871] w-full max-w-4xl">
            <Image
              src="/abstract.jpg"
              alt=""
              fill
              sizes="100vw"
              className="object-contain grayscale dark:invert"
            />
          </div>
        </motion.div>
        <Container>
          <SectionHeading
            index="01"
            eyebrow="Architecture"
            title="One core, four surfaces"
            lead="A single framework-agnostic kernel, delivered through the surface that fits how you work."
          />
          <RevealGroup className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:grid-rows-2">
            {surfaces.map((s, i) => {
              const featured = i === 0;
              return (
                <motion.div
                  key={s.slug}
                  variants={fadeUp}
                  className={cn(featured && "lg:col-span-2 lg:row-span-2")}
                >
                  <Link
                    href={`/docs/${s.slug}`}
                    className={cn(
                      "group hover:border-foreground/30 flex h-full flex-col justify-between gap-6 rounded-xl border p-6 transition-colors",
                      featured && "lg:p-8",
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="bg-muted flex size-9 items-center justify-center rounded-lg border">
                        <s.icon className="text-primary size-4" />
                      </div>
                      <span className="text-muted-foreground/50 font-mono text-xs">{pad(i)}</span>
                    </div>
                    <div className="flex flex-col gap-3">
                      <div>
                        <div className="font-mono text-sm font-medium">{s.name}</div>
                        <div className="text-muted-foreground text-sm">{s.tagline}</div>
                      </div>
                      {featured ? (
                        <ul className="text-muted-foreground mt-1 flex flex-col gap-1.5 text-sm">
                          {s.points.map((p) => (
                            <li key={p} className="flex gap-2">
                              <span className="text-foreground/30 select-none">—</span>
                              {p}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-foreground inline-flex items-center gap-1 text-sm opacity-0 transition-opacity group-hover:opacity-100">
                          Read docs <ArrowRight className="size-3.5" />
                        </span>
                      )}
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </RevealGroup>
        </Container>
      </div>
    </Section>
  );
}

/* ── Features: datasheet rows ─────────────────────────────────────────── */
export function FeaturesSection() {
  return (
    <Section id="features">
      <Container>
        <SectionHeading
          index="02"
          eyebrow="Why AvaKit"
          title="Everything you need, nothing you don't"
          lead="The boring parts — onboarding, wallets, chain switching, deploy — handled with safe defaults."
        />
        <Reveal className="mt-10 border-t">
          <dl>
            {features.map((f, i) => (
              <div
                key={f.title}
                className="hover:bg-muted/30 grid gap-2 border-b px-1 py-6 transition-colors md:grid-cols-12 md:gap-8 md:px-3"
              >
                <dt className="flex items-baseline gap-4 md:col-span-5">
                  <span className="text-muted-foreground/50 font-mono text-sm tabular-nums">
                    {pad(i)}
                  </span>
                  <span className="text-xl font-semibold tracking-tight uppercase sm:text-2xl">
                    {f.title}
                  </span>
                </dt>
                <dd className="text-muted-foreground pl-7 text-sm leading-relaxed md:col-span-7 md:pl-0">
                  {f.body}
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </Container>
    </Section>
  );
}

/* ── Steps: vertical timeline ─────────────────────────────────────────── */
export function StepsSection() {
  return (
    <Section id="how-it-works">
      <Container>
        <SectionHeading
          index="03"
          eyebrow="How it works"
          title="From zero to first transaction"
          lead="Three steps. No seed phrases, no boilerplate, no chain-config spelunking."
        />
        <ol className="mt-12 flex flex-col">
          {steps.map((step, i) => (
            <Reveal key={step.title}>
              <li
                className={cn(
                  "grid gap-6 border-l pb-10 pl-8 md:grid-cols-2 md:items-center md:gap-10",
                  i === steps.length - 1 && "border-l-transparent pb-0",
                )}
              >
                <div className="relative flex flex-col gap-2">
                  <span className="bg-primary text-primary-foreground absolute top-0.5 -left-11 flex size-6 items-center justify-center rounded-full font-mono text-xs">
                    {i + 1}
                  </span>
                  <h3 className="font-mono text-sm font-medium tracking-wide uppercase">
                    {step.title}
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{step.body}</p>
                </div>
                <CodeBlock code={step.code} />
              </li>
            </Reveal>
          ))}
        </ol>
      </Container>
    </Section>
  );
}

/* ── Templates preview ────────────────────────────────────────────────── */
export function TemplatesSection() {
  return (
    <Section id="templates">
      <Container>
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <SectionHeading
            index="04"
            eyebrow="Templates"
            title="Start from a working example"
            lead="Real, deploy-ready dapps with a social-login wallet and AI context baked in."
          />
          <Button asChild variant="outline" className="shrink-0">
            <Link href="/templates">
              All templates
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
        <RevealGroup className="mt-10 grid gap-3 sm:grid-cols-2">
          {templates.map((t, i) => (
            <motion.div key={t.id} variants={fadeUp}>
              <Link
                href="/templates"
                className="group hover:border-foreground/30 flex h-full flex-col gap-3 overflow-hidden rounded-xl border p-6 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground/50 font-mono text-xs">{pad(i)}</span>
                  {t.contracts ? (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      contract
                    </Badge>
                  ) : null}
                </div>
                <div className="relative aspect-[16/9] w-full">
                  <Image
                    src={t.art}
                    alt=""
                    fill
                    sizes="(min-width: 640px) 320px, 100vw"
                    className="object-contain grayscale mix-blend-multiply transition-transform duration-500 group-hover:scale-[1.03] dark:mix-blend-screen dark:invert"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="font-medium">{t.title}</span>
                  <span className="text-muted-foreground text-sm text-pretty">{t.description}</span>
                </div>
                <code className="text-muted-foreground/70 mt-auto pt-2 font-mono text-xs">
                  --template {t.id}
                </code>
              </Link>
            </motion.div>
          ))}
        </RevealGroup>
      </Container>
    </Section>
  );
}

/* ── MCP: split with tools table ──────────────────────────────────────── */
const MCP_CONFIG = `{
  "mcpServers": {
    "avakit": {
      "command": "npx",
      "args": ["-y", "@avakit/mcp"]
    }
  }
}`;

export function McpSection() {
  return (
    <Section id="mcp">
      <Container>
        <div className="grid gap-12 lg:grid-cols-2">
          <div className="flex flex-col gap-5">
            <SectionHeading
              index="05"
              eyebrow="AI-native"
              title="Let your agent build on Avalanche"
              lead="@avakit/mcp exposes actions — not just docs — to Claude Code and Cursor. Ask in natural language."
            />
            <div className="mt-1 flex flex-col gap-2">
              <span className="text-muted-foreground text-sm">Add it to your MCP client:</span>
              <CodeBlock code={MCP_CONFIG} />
            </div>
          </div>
          <Reveal className="lg:pt-2">
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool</TableHead>
                    <TableHead>Does</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mcpTools.map((tool) => (
                    <TableRow key={tool.name}>
                      <TableCell className="align-top">
                        <code className="font-mono text-xs">{tool.name}</code>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {tool.description}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}

/* ── FAQ ──────────────────────────────────────────────────────────────── */
export function FaqSection() {
  return (
    <Section id="faq">
      <Container className="max-w-3xl">
        <SectionHeading index="06" eyebrow="FAQ" title="Questions, answered" />
        <Reveal className="mt-8">
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq) => (
              <AccordionItem key={faq.q} value={faq.q}>
                <AccordionTrigger className="text-base">{faq.q}</AccordionTrigger>
                <AccordionContent>{faq.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </Container>
    </Section>
  );
}

/* ── CTA: inverted band ───────────────────────────────────────────────── */
export function CtaSection() {
  return (
    <Section>
      <Container>
        <Reveal>
          <div className="bg-foreground text-background relative flex flex-col items-center gap-6 overflow-hidden rounded-3xl px-6 py-16 text-center">
            <Eyebrow>Ship today</Eyebrow>
            <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Your first Avalanche dapp is one command away
            </h2>
            <p className="text-background/70 max-w-md text-balance">
              Open source, MIT licensed, free. No seed phrases, no boilerplate.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Button
                asChild
                size="lg"
                className="bg-background text-foreground hover:bg-background/90"
              >
                <Link href="/docs">
                  Get started
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-background/25 text-background hover:bg-background/10 hover:text-background bg-transparent"
              >
                <Link href="/templates">Browse templates</Link>
              </Button>
            </div>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
