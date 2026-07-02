import type { Metadata } from "next";

import { CodeBlock } from "@/components/code-block";
import { C, DocHeader, H2, NextLinks, P, UL } from "@/components/docs/prose";
import { Badge } from "@/components/ui/badge";
import { getContent } from "@/lib/content";

export const metadata: Metadata = {
  title: "create-avalanche-app",
  description: "Scaffold a batteries-included Avalanche dapp with one command.",
  alternates: { canonical: "/docs/cli" },
};

export default function CliDocs() {
  return (
    <>
      <DocHeader
        title="create-avalanche-app"
        lead="Scaffold a batteries-included Avalanche dapp: social-login onboarding, deploy-ready, AI-native."
      />

      <H2>Usage</H2>
      <CodeBlock code="npm create avalanche-app@latest" prefix="$" />
      <P>Or non-interactively:</P>
      <CodeBlock
        code="npm create avalanche-app@latest my-app -- --template nft-mint --yes"
        prefix="$"
      />

      <H2>What you get</H2>
      <P>Every generated app ships with:</P>
      <UL>
        <li>
          A social-login wallet via <C>@avakit/react</C> (plus injected wallets)
        </li>
        <li>shadcn/ui with dark/light wired from day one</li>
        <li>Deploy-ready contracts (where applicable) with bundled bytecode</li>
        <li>
          AI context — <C>CLAUDE.md</C>, <C>llms.txt</C>, and <C>.cursor/rules</C>
        </li>
      </UL>

      <H2>Templates</H2>
      <div className="flex flex-col gap-3">
        {getContent("en").templates.map((t) => (
          <div key={t.id} className="flex flex-col gap-1 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <span className="font-medium">{t.title}</span>
              <Badge variant="outline" className="font-mono text-[10px]">
                {t.id}
              </Badge>
            </div>
            <span className="text-muted-foreground text-sm">{t.description}</span>
          </div>
        ))}
      </div>

      <H2>Options</H2>
      <CodeBlock
        code={`-t, --template <id>     minimal | nft-mint | token-gated-app | erc20-token
-w, --wallet <id>       web3auth | injected      (default: web3auth)
-c, --chain <id>        fuji | c-chain           (default: fuji)
    --pm <manager>      pnpm | npm | yarn | bun
-y, --yes               skip prompts (non-interactive)
    --no-install        do not install dependencies`}
      />

      <NextLinks
        items={[
          {
            label: "Templates",
            href: "/templates",
            description: "Browse the available templates.",
          },
          {
            label: "@avakit/mcp",
            href: "/docs/mcp",
            description: "Scaffold from an AI agent instead.",
          },
        ]}
      />
    </>
  );
}
