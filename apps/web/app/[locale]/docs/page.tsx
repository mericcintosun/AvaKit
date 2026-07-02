import type { Metadata } from "next";

import { CodeBlock } from "@/components/code-block";
import { A, C, DocHeader, H2, NextLinks, Note, P, UL } from "@/components/docs/prose";

export const metadata: Metadata = {
  title: "Introduction",
  description:
    "Get started with AvaKit — the open-source, AI-native developer toolkit for Avalanche.",
  alternates: { canonical: "/docs" },
};

export default function DocsHome() {
  return (
    <>
      <DocHeader
        title="Introduction"
        lead="AvaKit is the open-source, AI-native developer toolkit for Avalanche — one core, four surfaces."
      />

      <P>
        AvaKit gets you from idea to first transaction in minutes: social-login onboarding (no seed
        phrases), a shadcn/ui design system with dark/light from day one, deploy-ready contracts,
        and AI context so Claude Code / Cursor understand your project. It <strong>wraps</strong>{" "}
        mature pieces — viem, Web3Auth, Foundry — rather than reinventing them.
      </P>

      <H2>Quickstart</H2>
      <P>Scaffold a full dapp with one command:</P>
      <CodeBlock code="npm create avalanche-app@latest my-app" prefix="$" />
      <P>Then:</P>
      <CodeBlock
        code={
          "cd my-app\npnpm install\ncp .env.example .env.local   # optional: Web3Auth client ID\npnpm dev"
        }
        prefix="$"
      />
      <P>
        Open <A href="http://localhost:3000">localhost:3000</A>, connect a wallet, and send your
        first transaction on Avalanche Fuji.
      </P>

      <H2>The four surfaces</H2>
      <P>
        Everything is built on one framework-agnostic kernel, consumed through the surface you need:
      </P>
      <UL>
        <li>
          <C>@avakit/core</C> — viem clients, wallet adapters, deploy helpers, and chain data.
        </li>
        <li>
          <C>@avakit/react</C> — <C>&lt;ConnectAvalanche /&gt;</C> and hooks, built on shadcn/ui.
        </li>
        <li>
          <C>create-avalanche-app</C> — the scaffolder that generates deploy-ready apps.
        </li>
        <li>
          <C>@avakit/mcp</C> — an MCP server so AI agents can scaffold, deploy, and read chain
          state.
        </li>
      </UL>

      <H2>Design principles</H2>
      <UL>
        <li>Onboarding friction lives on the dev side — AvaKit removes it, not the wallet's.</li>
        <li>Safe defaults: Fuji testnet first, mainnet is explicit opt-in, secrets stay in env.</li>
        <li>No lock-in: adapter-based wallets and copy-in shadcn components.</li>
        <li>AI-native: agent context ships with every app.</li>
      </UL>

      <Note>
        AvaKit is pre-release (0.1.0). The core, React layer, scaffolder, and MCP are built and
        verified; APIs may still change before 1.0.
      </Note>

      <NextLinks
        items={[
          {
            label: "@avakit/core",
            href: "/docs/core",
            description: "The kernel: chains, adapters, deploy, data.",
          },
          {
            label: "@avakit/react",
            href: "/docs/react",
            description: "Provider, ConnectAvalanche, and hooks.",
          },
          {
            label: "create-avalanche-app",
            href: "/docs/cli",
            description: "Scaffold a dapp from a template.",
          },
          {
            label: "@avakit/mcp",
            href: "/docs/mcp",
            description: "Drive Avalanche from Claude / Cursor.",
          },
        ]}
      />
    </>
  );
}
