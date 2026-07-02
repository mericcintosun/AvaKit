"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Copy } from "lucide-react";
import { useLocale } from "next-intl";
import { useState } from "react";

import { Container, Section, SectionHeading } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { getContent, type Locale } from "@/lib/content";

export function RecommenderSection() {
  const c = getContent(useLocale() as Locale);
  const [goalId, setGoalId] = useState<string | null>(null);

  const template = goalId ? (c.templates.find((t) => t.id === goalId) ?? null) : null;
  const command = template
    ? `npm create avalanche-app@latest my-app -- --template ${template.id}`
    : "";

  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Section id="recommender">
      <Container>
        <SectionHeading
          index="07"
          eyebrow={c.recommender.eyebrow}
          title={c.recommender.title}
          lead={c.recommender.lead}
        />

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {c.recommender.goals.map((goal) => {
            const active = goal.templateId === goalId;
            return (
              <button
                key={goal.templateId}
                type="button"
                onClick={() => setGoalId(active ? null : goal.templateId)}
                aria-pressed={active}
                className={`group flex items-center gap-3 rounded-xl border p-4 text-left text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary/5"
                    : "hover:border-foreground/30 hover:bg-muted/30"
                }`}
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${
                    active ? "border-primary/40 bg-primary/10" : "bg-muted"
                  }`}
                >
                  <goal.icon className={`size-4 ${active ? "text-primary" : "text-primary/80"}`} />
                </span>
                <span className="font-medium">{goal.label}</span>
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {template ? (
            <motion.div
              key={template.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="mt-6 overflow-hidden rounded-xl border"
            >
              <div className="flex flex-col gap-5 p-6 sm:p-8">
                <div className="flex flex-col gap-1">
                  <span className="text-primary font-mono text-xs tracking-[0.2em] uppercase">
                    {c.recommender.recommended}
                  </span>
                  <h3 className="text-2xl font-semibold tracking-tight">{template.title}</h3>
                  <p className="text-muted-foreground text-pretty">{template.description}</p>
                </div>

                <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  {template.highlights.map((h) => (
                    <li key={h} className="flex items-center gap-2">
                      <Check className="text-primary size-4 shrink-0" />
                      {h}
                    </li>
                  ))}
                </ul>

                <div className="group bg-muted/40 relative flex min-w-0 items-center rounded-lg border">
                  <pre className="min-w-0 flex-1 overflow-x-auto p-4 pr-12 font-mono text-sm">
                    <code>
                      <span className="text-primary select-none">$ </span>
                      {command}
                    </code>
                  </pre>
                  <button
                    type="button"
                    onClick={copy}
                    aria-label="Copy command"
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-2 transition-colors"
                  >
                    {copied ? (
                      <Check className="text-primary size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/templates">
                      {c.recommender.seeAll}
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Container>
    </Section>
  );
}
