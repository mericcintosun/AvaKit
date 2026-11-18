import type { Metadata } from "next";

import { CodeBlock } from "@/components/code-block";
import { A, C, DocHeader, H2, NextLinks, Note, P, UL } from "@/components/docs/prose";
import { site } from "@/lib/content";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  route: "/docs",
  title: "Introduction",
  description:
    "Get started with AvaKit, an open-source, AI-native developer toolkit for Avalanche.",
});

export default function DocsHome() {
  return (
    <>
      <DocHeader
        title="Introduction"
        lead="AvaKit is an open-source, AI-native developer toolkit for Avalanche: one framework-agnostic core plus four surfaces (React, a CLI, an MCP server, and Studio)."
      />

      <P>
        AvaKit gets you from idea to first transaction in minutes. You get a wallet chooser that
        starts with a temporary test wallet (no seed phrase, no account) and also offers browser
        wallets and, in the Fuji templates, social login; a shadcn/ui design system with dark and
        light from day one; contracts with bundled bytecode; and AI context so Claude Code and
        Cursor understand your project. It <strong>wraps</strong> mature pieces like viem, Web3Auth,
        and Foundry instead of reinventing them.
      </P>

      <H2>Three ways in</H2>
      <UL>
        <li>
          <strong>Nothing to install:</strong> <A href="/new">avakit.dev/new</A> deploys an NFT
          contract and mints from it on Fuji, in your browser.
        </li>
        <li>
          <strong>One command:</strong> <C>npm create avalanche-app@latest</C> scaffolds an app on
          your machine (the quickstart below).
        </li>
        <li>
          <strong>From a coding agent:</strong> add the <A href="/docs/mcp">MCP server</A> to Claude
          Code or Cursor and ask it to scaffold, deploy and mint.
        </li>
      </UL>
      <P>
        All three start with a temporary test wallet that is funded from AvaKit's shared Fuji
        faucet, so none of them needs an account for the first transaction. The faucet is
        rate-limited and meant for first runs only.
      </P>

      <H2>Quickstart</H2>
      <P>Scaffold a full dapp with one command:</P>
      <CodeBlock code="npm create avalanche-app@latest my-app" prefix="$" />
      <P>
        The CLI installs the dependencies, then prints the next steps for the template and package
        manager you picked. With npm, for most templates:
      </P>
      <CodeBlock code={"cd my-app\nnpm run dev"} prefix="$" />
      <P>
        Open <A href="http://localhost:3000">localhost:3000</A> and choose{" "}
        <strong>Start instantly</strong>: the app creates a temporary wallet in your browser and, on
        Fuji, funds it, so you can send your first transaction straight away. There is no wallet to
        choose up front: every Fuji template ships the same three ways in, the temporary wallet,
        social login, and a browser wallet (Core / MetaMask).
      </P>
      <Note>
        AvaKit is tested on Node.js 22 and 24. The CLI needs Node.js 22 or newer and stops with one
        line on anything older; Node 20 reached end of life in April 2026.
      </Note>
      <Note>
        Social login works on localhost with a bundled demo key, so there is nothing to configure to
        try it. Before you deploy to your own domain, copy <C>.env.example</C> to <C>.env.local</C>{" "}
        and add a free Web3Auth client ID.
      </Note>
      <Note>
        The <C>icm-messenger</C>, <C>l1-launch</C>, and <C>token-bridge</C> templates start a local
        Avalanche devnet first — run <C>npm run devnet</C> / <C>l1</C> / <C>bridge</C> before{" "}
        <C>npm run dev</C>. They need Avalanche CLI, which has been in maintenance mode since
        December 2025, and a Unix-like shell. See the <A href="/docs/cli">CLI docs</A>.
      </Note>

      <H2>The packages</H2>
      <P>
        Everything is built on one framework-agnostic kernel, consumed through the surface you need:
      </P>
      <UL>
        <li>
          <C>@avakit/core</C>: viem clients, wallet adapters, deploy helpers, and chain data.
        </li>
        <li>
          <C>@avakit/react</C>: <C>&lt;ConnectAvalanche /&gt;</C> and hooks, built on shadcn/ui.
        </li>
        <li>
          <C>create-avalanche-app</C>: the scaffolder that generates apps from eight templates.
        </li>
        <li>
          <C>@avakit/mcp</C>: an MCP server so AI agents can scaffold an app, deploy a contract,
          send a contract call such as mint, and read chain state.
        </li>
        <li>
          <C>@avakit/studio</C>: a local dashboard for L1s, Interchain Messaging, and on-chain data
          (also an MCP server).
        </li>
      </UL>

      <H2>AvaKit and the official tools</H2>
      <P>
        Ava Labs' <A href="https://build.avax.network">Builder Hub</A> has its own tools for the
        same job, and they are worth knowing. Studio, in the Builder Hub Console, is a hosted flow
        that takes a prompt to contracts, tests and a Fuji deployment, with a gated step to promote
        to mainnet; it needs a Builder Hub sign-in. The official MCP server is read-only: it looks
        up documentation and on-chain data and never signs. The official Fuji faucet needs a free
        Builder Hub sign-in.
      </P>
      <P>
        AvaKit is an independent, MIT-licensed project that runs on your machine: an npm CLI that
        writes the project into your own folder, React components, and an MCP server for your own
        coding agent that can also deploy and mint on Fuji. There is no official one-command{" "}
        <C>create-*</C> CLI on npm, and no AvaKit path needs an account for a first Fuji
        transaction. Use whichever fits; they work side by side.
      </P>

      <H2>Design principles</H2>
      <UL>
        <li>
          Developer-side friction first: setup, wallets, and funding a first test transaction.
        </li>
        <li>Safe defaults: Fuji testnet first, mainnet is explicit opt-in, secrets stay in env.</li>
        <li>No lock-in: adapter-based wallets, and UI that is plain code in your repo.</li>
        <li>AI-native: agent context ships with every app.</li>
      </UL>

      <H2>Status and limits</H2>
      <UL>
        <li>
          AvaKit is pre-1.0. All five packages are published on npm and the scaffold, deploy and
          mint path runs on Fuji, but APIs may still change before 1.0.
        </li>
        <li>
          Testnet first. Mainnet is a separate, guarded step, and only the <C>minimal</C> template
          can be scaffolded for C-Chain.
        </li>
        <li>
          Three templates and the local dashboard drive Avalanche CLI, which is in maintenance mode.
          They were last proven end to end in July 2026.
        </li>
        <li>
          The shared faucet is a convenience with limits, not infrastructure to build a product on.
        </li>
        <li>
          The project has one maintainer, and usage is small: the numbers are public on the{" "}
          <A href="/stats">stats page</A>.
        </li>
      </UL>

      <H2>Go deeper</H2>
      <P>
        The repository also holds the planning documents the project started from: the{" "}
        <A href={`${site.github}/blob/main/docs/00-vision-and-positioning.md`}>vision</A>, the{" "}
        <A href={`${site.github}/blob/main/docs/01-prd.md`}>PRD</A>, the{" "}
        <A href={`${site.github}/blob/main/docs/03-architecture.md`}>architecture</A>, the{" "}
        <A href={`${site.github}/blob/main/docs/04-adr.md`}>decision records</A>, and per-package
        specs. They were written in mid-2026, before and during the build, and parts of them are out
        of date, including what they say about the official tools; where they disagree with the
        code, the README or this site, they are the ones that are wrong. The same folder has the{" "}
        <A href={`${site.github}/blob/main/docs/12-security-review.md`}>security review</A> and an
        engineering list of <A href={`${site.github}/blob/main/docs/KNOWN-GAPS.md`}>known gaps</A>.
      </P>
      <P>
        Feel like a builder? <A href={site.github}>Star the repo on GitHub</A>, or grab all five
        packages <A href={site.npm}>on npm</A>.
      </P>

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
            description: "Drive Avalanche from Claude and Cursor.",
          },
          {
            label: "@avakit/studio",
            href: "/docs/studio",
            description: "A local dashboard for L1s and ICM.",
          },
        ]}
      />
    </>
  );
}
