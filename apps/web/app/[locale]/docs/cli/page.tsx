import type { Metadata } from "next";

import { CodeBlock } from "@/components/code-block";
import { A, C, DocHeader, H2, NextLinks, Note, P, UL } from "@/components/docs/prose";
import { Badge } from "@/components/ui/badge";
import { getContent, site } from "@/lib/content";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  route: "/docs/cli",
  title: "create-avalanche-app",
  description:
    "Scaffold an Avalanche dapp with one command: eight templates, a wallet chooser, and AI context files.",
});

const OFFICIAL_FAUCET = "https://build.avax.network/console/primary-network/faucet";

export default function CliDocs() {
  const templates = getContent("en").templates;

  return (
    <>
      <DocHeader
        title="create-avalanche-app"
        lead="Scaffold an Avalanche dapp with one command: a wallet chooser that starts with a temporary test wallet, a bundled contract where the template has one, and AI context files."
      />

      <H2>Requirements</H2>
      <UL>
        <li>
          Node.js 22, 24 or 26, the versions AvaKit is tested on. The CLI needs Node.js 22 or newer,
          because the library that draws its wizard does, and on anything older it stops with one
          line before creating anything. Node 20 reached end of life in April 2026.
        </li>
        <li>
          A package manager. The CLI installs the dependencies with the one you launched it with (
          <C>npm create</C>, <C>pnpm create</C>, <C>yarn create</C> or <C>bun create</C>), or with
          the one you name with <C>--pm</C>.
        </li>
      </UL>

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
          A wallet chooser from <C>@avakit/react</C>. The Fuji templates offer three ways in:{" "}
          <strong>Start instantly</strong> (a temporary wallet that needs no setup), social login,
          and browser wallets such as Core and MetaMask. The local-devnet templates offer the
          temporary wallet and browser wallets. There is no wallet choice at scaffold time.
        </li>
        <li>shadcn/ui with dark/light wired from day one</li>
        <li>A contract with bundled bytecode, where the template has one</li>
        <li>
          AI context: <C>CLAUDE.md</C>, <C>llms.txt</C>, and <C>.cursor/rules</C>
        </li>
      </UL>

      <H2>Templates</H2>
      <div className="flex flex-col gap-3">
        {templates.map((t) => (
          <div key={t.id} className="flex flex-col gap-1 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t.title}</span>
              <Badge variant="outline" className="font-mono text-[10px]">
                {t.id}
              </Badge>
            </div>
            <span className="text-muted-foreground text-sm">{t.description}</span>
          </div>
        ))}
      </div>

      <H2>Which template runs where</H2>
      <P>
        <C>--chain</C> (the Network step in the wizard) picks the chain the app is wired to, and a
        template only accepts the chains its manifest lists. Anything else is refused — by the CLI,
        by the wizard, which only offers the supported networks, and by <C>scaffold_app</C> in the
        MCP server — with a message that names the chains the template does support.
      </P>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Template</th>
              <th className="px-4 py-2 text-left font-medium">Runs on</th>
              <th className="px-4 py-2 text-left font-medium">
                <code className="font-mono text-xs">--chain c-chain</code>
              </th>
              <th className="px-4 py-2 text-left font-medium">Also needs</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            {templates.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="px-4 py-2">
                  <code className="text-foreground font-mono text-xs">{t.id}</code>
                </td>
                <td className="px-4 py-2">
                  {t.runsOn === "devnet" ? "Local devnet" : "Fuji testnet"}
                </td>
                <td className="px-4 py-2">{t.mainnet ? "Yes (mainnet)" : "No"}</td>
                <td className="px-4 py-2">
                  {t.runsOn === "devnet" ? "Avalanche CLI, a Unix-like shell" : "Nothing else"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <UL>
        <li>
          <C>minimal</C> is the only template that can be scaffolded for C-Chain mainnet. Mainnet is
          always something you ask for explicitly; nothing defaults to it.
        </li>
        <li>
          <C>nft-mint</C>, <C>token-gated-app</C> and <C>erc20-token</C> deploy a contract from the
          browser and are Fuji-only: a mainnet deploy needs an explicit confirmation that the
          generated apps do not ask for.
        </li>
        <li>
          <C>eerc-token</C> talks to an Encrypted ERC instance that exists on Fuji only.
        </li>
        <li>
          <C>icm-messenger</C>, <C>l1-launch</C> and <C>token-bridge</C> run on the local devnet
          their setup script starts. <C>fuji</C>, the default, is the only value they accept.
        </li>
      </UL>

      <H2>Your first transaction on Fuji</H2>
      <P>
        In the five Fuji templates the first choice is <strong>Start instantly</strong>: a temporary
        wallet created in your browser when you pick it. The app then funds it from AvaKit's shared
        faucet, so you can deploy and mint without creating an account anywhere.
      </P>
      <UL>
        <li>
          The shared faucet is a convenience for first runs, paid for by the maintainer: one small
          drip per address per day, rate-limited, and it can run empty. Do not build a product on
          it.
        </li>
        <li>
          If it refuses, the app shows the reason, a retry, and a link to the{" "}
          <A href={OFFICIAL_FAUCET}>official Fuji faucet</A>, which needs a free Builder Hub
          sign-in.
        </li>
        <li>
          Set <C>NEXT_PUBLIC_AVAKIT_FAUCET_URL</C> in <C>.env.local</C> to the URL of a faucet you
          run yourself (<A href={`${site.github}/tree/main/services/faucet`}>services/faucet</A> in
          the repository), or to <C>off</C> to disable automatic funding.
        </li>
        <li>
          The temporary wallet keeps a throwaway key in the browser's storage and is testnet-only:
          an app scaffolded for mainnet does not offer it.
        </li>
      </UL>

      <H2>Next steps</H2>
      <P>The CLI prints the exact next steps for your choices. Two things vary:</P>
      <UL>
        <li>
          Social login works on localhost via a bundled demo key, so there is nothing to set up to
          try it. Only your own deployment needs a client id — then copy <C>.env.example</C> to{" "}
          <C>.env.local</C> and add it.
        </li>
        <li>
          The <C>icm-messenger</C>, <C>l1-launch</C>, and <C>token-bridge</C> templates run a local
          devnet first: <C>npm run devnet</C> / <C>npm run l1</C> / <C>npm run bridge</C> before{" "}
          <C>npm run dev</C> (with the package manager you chose). These need Avalanche CLI and a
          Unix-like shell (macOS, Linux, or WSL2 on Windows).
        </li>
      </UL>
      <Note>
        Avalanche CLI has been in maintenance mode since December 2025. These three templates still
        drive it and were last proven end to end in July 2026; moving them to the supported tooling
        is planned work.
      </Note>
      <Note>
        The devnet templates use distinct local chain names — <C>icm1</C>/<C>icm2</C> for
        icm-messenger and <C>br1</C>/<C>br2</C> for token-bridge — so you can run both at once. If a
        stale local network blocks a deploy, reset with <C>avalanche network clean</C> or rebuild in
        one step with <C>CLEAN=1 npm run devnet</C> (or <C>l1</C> / <C>bridge</C>).
      </Note>

      <H2>Options</H2>
      <CodeBlock
        code={`-t, --template <id>     minimal | nft-mint | token-gated-app | erc20-token |
                        icm-messenger | eerc-token | l1-launch | token-bridge
-c, --chain <id>        fuji | c-chain        (default: fuji)
                        c-chain (mainnet) only with: minimal
    --pm <manager>      pnpm | npm | yarn | bun
                        (default: the one you ran this with, else npm)
-y, --yes               skip prompts (non-interactive)
    --no-install        do not install dependencies
    --no-telemetry      opt out of anonymous usage counting (persisted)
    --telemetry         opt back in (persisted)
-v, --version           print version
-h, --help              print this help`}
      />

      <H2>When something goes wrong</H2>
      <UL>
        <li>
          Anything the CLI does not recognise — a mistyped flag, an unknown template, chain or
          package manager, an unsafe project name — is an error that lists the valid values and
          exits with status 1. It is never replaced with a default.
        </li>
        <li>
          A target directory that already exists and is not empty is refused before anything is
          written.
        </li>
        <li>
          If the package manager is missing or the install fails, the project is still created, but
          the CLI says what went wrong, prints the commands to run by hand, and exits with a
          non-zero status, so a script never carries on with a half-set-up app.
        </li>
        <li>A scaffold that fails part-way removes what it wrote, so a retry starts clean.</li>
      </UL>

      <H2>Telemetry</H2>
      <P>
        The CLI counts scaffolds anonymously — which template you picked and whether it worked,
        never your project name, paths, or code. It says so on the first run, and{" "}
        <C>AVAKIT_TELEMETRY_DISABLED=1</C> turns it off. See <A href="/docs/telemetry">Telemetry</A>{" "}
        for the exact payload and the reasoning.
      </P>

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
