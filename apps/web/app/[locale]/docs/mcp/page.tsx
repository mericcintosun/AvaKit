import type { Metadata } from "next";

import { CodeBlock } from "@/components/code-block";
import { C, DocHeader, H2, NextLinks, Note, P } from "@/components/docs/prose";
import { getContent } from "@/lib/content";

export const metadata: Metadata = {
  title: "@avakit/mcp",
  description: "An MCP server so Claude Code / Cursor can scaffold, deploy, and read Avalanche.",
  alternates: { canonical: "/docs/mcp" },
};

const CONFIG = `{
  "mcpServers": {
    "avakit": {
      "command": "npx",
      "args": ["-y", "@avakit/mcp"]
    }
  }
}`;

export default function McpDocs() {
  return (
    <>
      <DocHeader
        title="@avakit/mcp"
        lead="An MCP server that exposes Avalanche actions, not just docs, to Claude Code and Cursor."
      />

      <H2>Add to your MCP client</H2>
      <P>
        Drop this into your Claude Code, Cursor, or Claude Desktop MCP configuration. No install
        needed; <C>npx</C> fetches it on demand.
      </P>
      <CodeBlock code={CONFIG} />

      <H2>Tools</H2>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Tool</th>
              <th className="px-4 py-2 text-left font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {getContent("en").mcp.tools.map((tool) => (
              <tr key={tool.name} className="border-t">
                <td className="px-4 py-2 align-top">
                  <code className="font-mono text-xs">{tool.name}</code>
                </td>
                <td className="text-muted-foreground px-4 py-2">{tool.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2>Example</H2>
      <P>Ask your agent in natural language:</P>
      <CodeBlock code={"“Scaffold an nft-mint dapp called gm-avax and deploy it to Fuji.”"} />
      <P>
        The agent calls <C>scaffold_app</C>, then <C>deploy_contract</C>, then reads the result back
        with <C>read_chain</C>.
      </P>

      <H2>Deploy key</H2>
      <Note>
        <C>deploy_contract</C> signs with a private key from the <C>AVAKIT_DEPLOYER_KEY</C>{" "}
        environment variable. Use a <strong>throwaway testnet key</strong> — never one holding real
        funds. Mainnet deploys require an explicit <C>confirm: true</C>.
      </Note>

      <NextLinks
        items={[
          {
            label: "create-avalanche-app",
            href: "/docs/cli",
            description: "The scaffolder the MCP wraps.",
          },
          {
            label: "@avakit/core",
            href: "/docs/core",
            description: "The deploy + data primitives it uses.",
          },
          {
            label: "@avakit/studio",
            href: "/docs/studio",
            description: "A local dashboard that is also an MCP server.",
          },
        ]}
      />
    </>
  );
}
