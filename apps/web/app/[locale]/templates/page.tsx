import { Check } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { setRequestLocale } from "next-intl/server";

import { CodeBlock } from "@/components/code-block";
import { Reveal } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { getContent, type Locale } from "@/lib/content";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const c = getContent(locale);
  const path = locale === "en" ? "/templates" : `/${locale}/templates`;
  return {
    title: c.templatesSection.eyebrow,
    description: c.templatesPage.lead,
    alternates: {
      canonical: path,
      languages: { en: "/templates", tr: "/tr/templates" },
    },
  };
}

// White-background line art that sits seamlessly on any card in both themes.
const artClass =
  "object-contain p-6 grayscale mix-blend-multiply dark:invert dark:mix-blend-screen";

export default async function TemplatesPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const c = getContent(locale);

  return (
    <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
      <Reveal className="flex flex-col gap-3">
        <span className="text-muted-foreground font-mono text-xs tracking-[0.2em] uppercase">
          {c.templatesPage.eyebrow}
        </span>
        <h1 className="text-primary text-4xl font-semibold tracking-tight">
          {c.templatesPage.title}
        </h1>
        <p className="text-muted-foreground max-w-2xl text-balance">{c.templatesPage.lead}</p>
      </Reveal>

      <div className="mt-12 flex flex-col gap-6">
        {c.templates.map((t) => (
          <Reveal key={t.id}>
            <div className="overflow-hidden rounded-xl border">
              <div className="grid md:grid-cols-[minmax(0,280px)_1fr] md:divide-x">
                <div className="relative bg-white dark:bg-[#101010]">
                  <div className="relative aspect-square w-full">
                    <Image
                      src={t.art}
                      alt={`${t.title} illustration`}
                      fill
                      sizes="(min-width: 768px) 280px, 100vw"
                      quality={95}
                      className={artClass}
                    />
                  </div>
                </div>
                <div className="flex min-w-0 flex-col gap-5 p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold">{t.title}</h2>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {t.id}
                    </Badge>
                    {t.contracts ? (
                      <Badge
                        variant="secondary"
                        className="font-mono text-[10px]"
                        title="Contract bytecode is bundled — no Foundry needed to run. Foundry is only for editing the contract."
                      >
                        Bundled contract
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-base text-pretty">{t.description}</p>
                  <ul className="flex flex-col gap-2">
                    {t.highlights.map((h) => (
                      <li key={h} className="flex items-center gap-2 text-sm">
                        <Check className="text-primary size-4 shrink-0" />
                        {h}
                      </li>
                    ))}
                  </ul>
                  <CodeBlock
                    code={`npm create avalanche-app@latest my-app -- --template ${t.id}`}
                    prefix="$"
                  />
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-12 rounded-xl border border-dashed p-6 text-center">
        <p className="text-muted-foreground text-sm">{c.templatesPage.more}</p>
      </Reveal>
    </div>
  );
}
