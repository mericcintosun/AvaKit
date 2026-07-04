import type { Metadata } from "next";

import { CodeBlock } from "@/components/code-block";
import { A, C, DocHeader, H2, NextLinks, Note, P, UL } from "@/components/docs/prose";
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

      <Note>
        <strong>Read this first.</strong> Pasting the JSON below into a chat message does{" "}
        <strong>not</strong> connect the server — the model just sees text. It has to go into your
        MCP client's <strong>config file</strong> (or be added with the CLI command), and then you{" "}
        <strong>restart the client</strong>. It worked when your client lists an <C>avakit</C> tool.
      </Note>
      <P>
        You need <A href="https://nodejs.org">Node.js</A> installed (for <C>npx</C>). There's
        nothing else to install — <C>npx</C> fetches the server on demand. Follow the steps for your
        client.
      </P>

      <H2>Claude Code (CLI)</H2>
      <P>One command, no file to edit:</P>
      <CodeBlock code="claude mcp add avakit -- npx -y @avakit/mcp" prefix="$" />
      <P>
        Run <C>/mcp</C> inside Claude Code to confirm <C>avakit</C> is connected, then just ask in
        natural language (see the example below).
      </P>

      <H2>Cursor</H2>
      <P>
        Open <strong>Settings → Tools & MCP → Add new MCP server</strong>, or create/edit{" "}
        <C>~/.cursor/mcp.json</C> and add:
      </P>
      <CodeBlock code={CONFIG} />
      <P>
        Save and reload Cursor. The server shows up under Settings → MCP with a green dot when it's
        connected.
      </P>

      <H2>Claude Desktop</H2>
      <P>
        Open (or create) the config file, paste the JSON, save, then fully restart the app. The file
        lives at:
      </P>
      <UL>
        <li>
          macOS: <C>~/Library/Application Support/Claude/claude_desktop_config.json</C>
        </li>
        <li>
          Windows: <C>%APPDATA%\Claude\claude_desktop_config.json</C>
        </li>
      </UL>
      <CodeBlock code={CONFIG} />
      <P>
        Then <strong>fully quit and reopen</strong> Claude Desktop (close the window is not enough —
        quit it completely). Open a chat and click the tools / plug icon in the message box; you
        should see <C>avakit</C> and its tools. Now ask in natural language.
      </P>

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

      <Note>
        Tool inputs are validated with strict schemas — unknown parameters are rejected rather than
        silently ignored, so a mistyped field (e.g. <C>network</C> instead of <C>chain</C>) fails
        loudly instead of falling back to a default.
      </Note>

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
