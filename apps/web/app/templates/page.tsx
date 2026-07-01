import { Check } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";

import { CodeBlock } from "@/components/code-block";
import { Reveal } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { templates } from "@/lib/content";

export const metadata: Metadata = {
  title: "Templates",
  description: "Deploy-ready Avalanche dapp templates: minimal, NFT mint, token-gated, and ERC-20.",
};

// White-background line art that sits seamlessly on any card in both themes.
const artClass =
  "object-contain p-6 grayscale mix-blend-multiply dark:invert dark:mix-blend-screen";

export default function TemplatesPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
      <Reveal className="flex flex-col gap-3">
        <span className="text-muted-foreground font-mono text-xs tracking-[0.2em] uppercase">
          Templates
        </span>
        <h1 className="text-4xl font-semibold tracking-tight">Start from a working example</h1>
        <p className="text-muted-foreground max-w-2xl text-balance">
          Every template is a real, deploy-ready dapp — shadcn/ui, a social-login wallet, dark/light
          from day one, and AI context files so Claude / Cursor understand it out of the box.
        </p>
      </Reveal>

      <div className="mt-12 flex flex-col gap-6">
        {templates.map((t) => (
          <Reveal key={t.id}>
            <div className="overflow-hidden rounded-xl border">
              <div className="grid md:grid-cols-[minmax(0,280px)_1fr] md:divide-x">
                <div className="bg-muted/20 relative aspect-square">
                  <Image
                    src={t.art}
                    alt={`${t.title} illustration`}
                    fill
                    sizes="(min-width: 768px) 280px, 100vw"
                    quality={95}
                    className={artClass}
                  />
                </div>
                <div className="flex flex-col gap-5 p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold">{t.title}</h2>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {t.id}
                    </Badge>
                    {t.contracts ? (
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        Foundry contract
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-base text-pretty">{t.description}</p>
                  <ul className="flex flex-col gap-2">
                    {t.highlights.map((h) => (
                      <li key={h} className="flex items-center gap-2 text-sm">
                        <Check className="size-4 shrink-0" />
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
        <p className="text-muted-foreground text-sm">
          More templates are on the way. Want one? Contributions welcome — every template is just a
          folder under <code className="font-mono">templates/</code> with a manifest.
        </p>
      </Reveal>
    </div>
  );
}
