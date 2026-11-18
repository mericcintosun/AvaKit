import type { Metadata } from "next";

import { CodeBlock } from "@/components/code-block";
import { C, DocHeader, H2, NextLinks, Note, P, UL } from "@/components/docs/prose";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  route: "/docs/studio",
  title: "@avakit/studio",
  description:
    "A local Avalanche development dashboard: spin up L1s, send Interchain messages, inspect on-chain data, and launch an L1 on Fuji. Also an MCP server.",
});

export default function StudioDocs() {
  return (
    <>
      <DocHeader
        title="@avakit/studio"
        lead="A local control center for Avalanche development. You run it from your own terminal; it opens a browser dashboard, à la Prisma Studio."
      />

      <H2>Run it</H2>
      <P>No install needed. Start the dashboard with:</P>
      <CodeBlock code="npx @avakit/studio" prefix="$" />
      <P>
        Studio starts a server bound to <C>127.0.0.1</C> and opens the dashboard in your browser.
        The devnet, Interchain, and Fuji features shell out to <C>avalanche-cli</C> and Foundry (
        <C>forge</C> / <C>cast</C>), so install those to use them; the Data view works without them.
      </P>
      <Note>
        Avalanche CLI has been in maintenance mode since December 2025. The Devnet, Interchain and
        Launch on Fuji views still drive it and were last proven end to end in July 2026; moving the
        dashboard to the supported tooling is planned work.
      </Note>
      <Note>
        Not the same thing as Studio in Ava Labs' Builder Hub Console, which is a hosted flow from a
        prompt to deployed contracts. <C>@avakit/studio</C> is a dashboard for local devnets that
        runs on your own machine.
      </Note>

      <H2>Views</H2>
      <UL>
        <li>
          <C>Overview</C>: a snapshot of your local Avalanche environment and running devnets.
        </li>
        <li>
          <C>Devnet</C>: spin up local L1s with Interchain Messaging, or launch your own L1 with a
          custom name, chain id, and token.
        </li>
        <li>
          <C>Interchain</C>: deploy messenger contracts on each L1 and send a cross-chain message,
          watching it arrive.
        </li>
        <li>
          <C>Launch on Fuji</C>: a guided wizard that creates a key for you to fund with test AVAX,
          moves the funds from the C-Chain to the P-Chain, and deploys a sovereign L1 to the Fuji
          testnet with your machine as its validator.
        </li>
        <li>
          <C>Data</C>: look up balances, NFTs, and transaction history for any Fuji or C-Chain
          address (via the AvaCloud Data API).
        </li>
        <li>
          <C>Environment</C>: detect your toolchain (avalanche-cli, Foundry, Node) and copy an MCP
          config to connect an AI agent.
        </li>
      </UL>

      <H2>MCP mode</H2>
      <P>
        Studio exposes the same actions to AI agents over stdio. Point Claude Code or Cursor at:
      </P>
      <CodeBlock
        code={
          '{\n  "mcpServers": {\n    "avakit-studio": {\n      "command": "npx",\n      "args": ["-y", "@avakit/studio", "mcp"]\n    }\n  }\n}'
        }
      />
      <P>
        The agent can then inspect the environment, spin up devnets, launch L1s, send Interchain
        messages, and read address data. One tool, two faces: a dashboard for humans and an MCP
        server for agents.
      </P>

      <Note>
        Studio is a tool you launch yourself, so it may run local processes. It binds 127.0.0.1
        only, checks the Host header, gates every API call behind a per-session token, and runs
        external tools through argument arrays built from validated values (never a shell). It runs
        one avalanche-cli action at a time: the server owns the run, so it carries on when the tab
        that started it reloads or closes, any tab can follow its log, and a second action is
        refused until the first has finished or been cancelled. See <C>SECURITY.md</C>.
      </Note>

      <NextLinks
        items={[
          {
            label: "@avakit/mcp",
            href: "/docs/mcp",
            description: "The standalone MCP server for scaffolding and deploying.",
          },
          {
            label: "Templates",
            href: "/templates",
            description: "Launch your own L1 or a cross-chain bridge from a template.",
          },
        ]}
      />
    </>
  );
}
