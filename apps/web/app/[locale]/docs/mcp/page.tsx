import type { Metadata } from "next";

import { CodeBlock } from "@/components/code-block";
import { A, C, DocHeader, H2, NextLinks, Note, P, UL } from "@/components/docs/prose";
import { getContent } from "@/lib/content";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  route: "/docs/mcp",
  title: "@avakit/mcp",
  description:
    "An MCP server so Claude Code and Cursor can scaffold an Avalanche dapp, deploy its contract and mint on the Fuji testnet, and read chain state.",
});

const CONFIG = `{
  "mcpServers": {
    "avakit": {
      "command": "npx",
      "args": ["-y", "@avakit/mcp"]
    }
  }
}`;

// Claude Desktop starts servers outside any project folder (in "/" on macOS),
// and scaffold_app refuses to create projects there: see resolveScaffoldTarget
// in packages/mcp/src/guards.ts. So its config names the directory to use.
const DESKTOP_CONFIG = `{
  "mcpServers": {
    "avakit": {
      "command": "npx",
      "args": ["-y", "@avakit/mcp"],
      "env": {
        "AVAKIT_MCP_ROOT": "/Users/you/projects"
      }
    }
  }
}`;

// Mainnet needs the operator's own key and this env var on the server, plus
// confirm:true on the call (see assertMainnetAllowed in packages/mcp/src/guards.ts).
const MAINNET_CONFIG = `{
  "mcpServers": {
    "avakit": {
      "command": "npx",
      "args": ["-y", "@avakit/mcp"],
      "env": {
        "AVAKIT_DEPLOYER_KEY": "0x…",
        "AVAKIT_ALLOW_MAINNET": "1"
      }
    }
  }
}`;

// The same prompt the package README gives: three tool calls, no key, and
// nothing the agent has to read from disk. Broken over two lines only so the
// whole of it shows in the code block; the line break is harmless in a chat.
const FIRST_PROMPT = `Create an NFT app called my-first-dapp with AvaKit, deploy its contract to Fuji
and mint the first NFT. Give me the explorer links.`;

// The two write limits, set where the client configures the server (see
// packages/mcp/src/limits.ts). Both are in @avakit/mcp from 0.3.0.
const LIMITS_CONFIG = `{
  "mcpServers": {
    "avakit": {
      "command": "npx",
      "args": ["-y", "@avakit/mcp"],
      "env": {
        "AVAKIT_WRITE_ALLOWLIST": "0x52908400098527886E0F7030069857D2E4169EE7",
        "AVAKIT_MAX_VALUE": "0.5"
      }
    }
  }
}`;

// The refusal assertCallAllowed returns, word for word, for a contract the
// limits do not allow.
const ALLOWLIST_REFUSAL =
  "Refusing to call 0x52908400098527886E0F7030069857D2E4169EE7 on Avalanche Fuji: write_contract calls only the contracts this server deployed in this session and the ones AVAKIT_WRITE_ALLOWLIST lists in the server environment, which only the person running the server can change. Nothing was signed or sent.";

const OFFICIAL_FAUCET = "https://build.avax.network/console/primary-network/faucet";

// What the tools that write take and return, for the "Inputs and results"
// table. These names are the package's contract: an agent (and the end-to-end
// test) calls the tools by them, so check packages/mcp/src before changing one.
const SIGNATURES: { tool: string; takes: string; returns: string }[] = [
  {
    tool: "scaffold_app",
    takes: "name, template?, chain?, directory?",
    returns:
      "The created files, plus artifacts (the paths of the project's contract artifacts, ready to pass as artifactPath) and nextSteps.",
  },
  {
    tool: "deploy_contract",
    takes: "artifactPath, or abi + bytecode; args?, chain?, confirm?",
    returns:
      "address, txHash, explorerUrl and signer, once the transaction has succeeded and code has been read back from the address.",
  },
  {
    tool: "write_contract",
    takes: "address, functionName, args?, value?, and artifactPath or abi; chain?, confirm?",
    returns:
      "txHash, status, blockNumber, explorerUrl and signer, once the call has succeeded on chain. It is simulated first: a call that would revert comes back as an error and nothing is sent.",
  },
  {
    tool: "wallet_status",
    takes: "chain?",
    returns:
      'address, source ("session", "env" or "none"), chain, balanceWei and balanceAvax. Read-only: it never asks the faucet for funds.',
  },
];

// Every variable the server reads. None of them can be set by a tool call.
const ENVIRONMENT: { name: string; does: string }[] = [
  {
    name: "AVAKIT_DEPLOYER_KEY",
    does: "A private key for the signing tools to use instead of the session test wallet. Optional on Fuji, required for mainnet.",
  },
  {
    name: "AVAKIT_TEST_WALLET",
    does: "Set to 0 to switch the session test wallet off. The signing tools then need AVAKIT_DEPLOYER_KEY.",
  },
  {
    name: "AVAKIT_FAUCET_URL",
    does: "The faucet that funds the session test wallet, in place of AvaKit's shared one: for example your own deployment of services/faucet.",
  },
  {
    name: "AVAKIT_ALLOW_MAINNET",
    does: "Set to 1 to allow mainnet transactions, which also need confirm: true in the call and your own key. Unset, the server is testnet-only.",
  },
  {
    name: "AVAKIT_WRITE_ALLOWLIST",
    does: "From 0.3.0: comma-separated contract addresses write_contract may call besides the contracts the server deployed in this session; * allows any. Unset, only this session's deployments.",
  },
  {
    name: "AVAKIT_MAX_VALUE",
    does: "From 0.3.0: the most AVAX one deploy_contract or write_contract call may send, as a decimal number. Unset, 0.1; 0 allows none.",
  },
  {
    name: "AVAKIT_MCP_ROOT",
    does: "The directory scaffold_app creates projects in, and artifactPath reads from, instead of the server's working directory. Needed when a client starts the server outside a project folder.",
  },
];

export default function McpDocs() {
  return (
    <>
      <DocHeader
        title="@avakit/mcp"
        lead="An MCP server that lets Claude Code, Cursor and Claude Desktop scaffold an Avalanche dapp, deploy its contract and send contract calls on the Fuji testnet, and read chain state."
      />

      <Note>
        <strong>Read this first.</strong> Pasting the JSON below into a chat message does{" "}
        <strong>not</strong> connect the server — the model just sees text. It has to go into your
        MCP client's <strong>config file</strong> (or be added with the CLI command), and then you{" "}
        <strong>restart the client</strong>. It worked when your client lists the <C>avakit</C>{" "}
        server with tools such as <C>scaffold_app</C>.
      </Note>
      <P>
        You need <A href="https://nodejs.org">Node.js</A> installed (for <C>npx</C>); AvaKit is
        tested on Node 22, 24 and 26. There's nothing else to install — <C>npx</C> fetches the
        server on demand — and on Fuji there is no key to create. Follow the steps for your client.
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
        <li className="[overflow-wrap:anywhere]">
          macOS: <C>~/Library/Application Support/Claude/claude_desktop_config.json</C>
        </li>
        <li className="[overflow-wrap:anywhere]">
          Windows: <C>%APPDATA%\Claude\claude_desktop_config.json</C>
        </li>
      </UL>
      <CodeBlock code={DESKTOP_CONFIG} />
      <P>
        Claude Desktop does not start servers inside a project folder, so <C>scaffold_app</C> has to
        be told where new projects go: set <C>AVAKIT_MCP_ROOT</C> to a directory of your own, as
        above. Without it the tool refuses to scaffold rather than write somewhere you did not
        choose.
      </P>
      <P>
        Then <strong>fully quit and reopen</strong> Claude Desktop (close the window is not enough —
        quit it completely). Open a chat and click the tools / plug icon in the message box; you
        should see <C>avakit</C> and its tools. Now ask in natural language.
      </P>

      <H2>Try it</H2>
      <P>With the server connected, give your agent this prompt:</P>
      <CodeBlock code={`“${FIRST_PROMPT}”`} />
      <P>
        It takes three tool calls and no key. <C>scaffold_app</C> creates the project and returns
        the path of its contract artifact, <C>deploy_contract</C> deploys that artifact to Fuji, and{" "}
        <C>write_contract</C> sends <C>mint</C>. The deploy and the mint each come back with an
        explorer link, and <C>read_chain</C> can read the result back from the chain.
      </P>

      <H2>Tools</H2>
      <div className="overflow-x-auto rounded-lg border">
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
      <P>
        <C>deploy_contract</C> and <C>write_contract</C> take the contract either inline (<C>abi</C>
        , and <C>bytecode</C> for a deploy) or by reference: <C>artifactPath</C> names an artifact
        file inside the directory the server creates projects in, such as the{" "}
        <C>lib/nft-artifact.ts</C> a template ships or a Foundry JSON artifact. The file is parsed,
        never run. For a single call <C>abi</C> can also be a list of signatures, for example{" "}
        <C>["function mint() returns (uint256)"]</C>.
      </P>

      <H2>Inputs and results</H2>
      <P>
        <C>chain</C> is <C>"fuji"</C> (the default) or <C>"c-chain"</C>, and <C>confirm</C> only
        matters on mainnet. A field marked <C>?</C> is optional. Every result is JSON, and a failure
        is returned as a tool error with the reason in plain text.
      </P>
      {/* Three columns of prose do not fit a phone: keep the table wide enough
          to read and let its wrapper scroll sideways. */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Tool</th>
              <th className="px-4 py-2 text-left font-medium">Takes</th>
              <th className="px-4 py-2 text-left font-medium">Returns</th>
            </tr>
          </thead>
          <tbody>
            {SIGNATURES.map((row) => (
              <tr key={row.tool} className="border-t">
                <td className="px-4 py-2 align-top">
                  <code className="font-mono text-xs">{row.tool}</code>
                </td>
                <td className="px-4 py-2 align-top">
                  <code className="font-mono text-xs">{row.takes}</code>
                </td>
                <td className="text-muted-foreground px-4 py-2">{row.returns}</td>
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

      <H2>Signing on Fuji: the session test wallet</H2>
      <P>
        <C>deploy_contract</C> and <C>write_contract</C> need a signer. On Fuji, when you have not
        configured a key, the server makes one for the session:
      </P>
      <UL>
        <li>
          A private key is generated in memory the first time a signing tool runs, and it lives only
          as long as the server process. It is never written to disk, never logged and never
          returned to the model; tools only ever show its address.
        </li>
        <li>
          It works on Fuji (chain id <C>43113</C>) and nowhere else. Every other chain refuses it.
        </li>
        <li>
          When it cannot pay for a transaction, the server asks AvaKit's shared faucet for one drip
          and waits for it to arrive. That faucet is a convenience for first runs: it is
          rate-limited (one small drip per address per day, with a cap per network address) and it
          can run empty.
        </li>
        <li>
          It never sends AVAX: a call with a non-zero <C>value</C> is refused unless you sign with
          your own key.
        </li>
        <li>
          Every signing result says who signed: <C>signer.source</C> is <C>session</C> for this
          wallet and <C>env</C> for your own key. <C>wallet_status</C> shows the address and its
          balance without sending anything.
        </li>
      </UL>
      <P>
        If the faucet refuses, the tool's error says why and names the two ways forward: set{" "}
        <C>AVAKIT_DEPLOYER_KEY</C> to a Fuji key you funded yourself, or get test AVAX from the{" "}
        <A href={OFFICIAL_FAUCET}>official faucet</A>, which needs a free Builder Hub sign-in. To
        switch the session wallet off altogether, start the server with <C>AVAKIT_TEST_WALLET=0</C>.
        To fund it from a faucet of your own, set <C>AVAKIT_FAUCET_URL</C>.
      </P>
      <Note>
        The session test wallet is one of two places where AvaKit creates a private key itself; the
        other is the temporary wallet in the browser. Both are throwaway and testnet-only. Never
        send real funds to either.
      </Note>

      <H2>Using your own key</H2>
      <P>
        Set <C>AVAKIT_DEPLOYER_KEY</C> in the server's environment and the signing tools use it
        instead of the session wallet. For Fuji, use a <strong>throwaway testnet key</strong>, never
        one that holds real funds. The key is read from the environment only: it is not a tool
        argument, and it is never logged or returned.
      </P>

      <H2>Write limits</H2>
      <Note>
        The write limits are in <C>@avakit/mcp</C> from 0.3.0. Versions up to 0.2.1 have neither of
        them.
      </Note>
      <P>
        An agent can be steered by what it reads: a README, an issue, a web page. So the two signing
        tools are held to two limits that come from the server's environment, which a tool call
        cannot change:
      </P>
      <UL>
        <li>
          <strong>Which contracts.</strong> <C>write_contract</C> calls a contract only when this
          server deployed it with <C>deploy_contract</C>, on the same chain, since it started, which
          is all the prompt above needs, or when <C>AVAKIT_WRITE_ALLOWLIST</C> lists its address.
          The list is comma-separated, each address all lowercase or with a valid checksum, and an
          address on it may be called on every chain the server signs for. <C>*</C> allows any
          contract.
        </li>
        <li>
          <strong>How much AVAX.</strong> One <C>deploy_contract</C> or <C>write_contract</C> call
          sends at most <C>AVAKIT_MAX_VALUE</C> AVAX, 0.1 while it is not set, and <C>0</C> allows
          none. Only a call signed with your own key on Fuji can carry value at all.
        </li>
      </UL>
      <P>
        Both are checked before the chain or the faucet is asked anything, and again when the
        transaction is signed. A refusal names the variable to change and says that nothing was
        signed or sent, as in:
      </P>
      <P className="[overflow-wrap:anywhere]">“{ALLOWLIST_REFUSAL}”</P>
      <P>
        A list entry that is not an address, or an <C>AVAKIT_MAX_VALUE</C> that is not an amount of
        AVAX, refuses every call that variable governs until it is fixed. The limits hold per call:
        there is no daily or session cap, no list of the functions that may be called, no gas cap
        and no confirmation by a person, and a contract the server deployed can pass on the calls
        and the AVAX it receives. Set both variables in your user-level MCP client config, not in a
        project file an agent can edit:
      </P>
      <CodeBlock code={LIMITS_CONFIG} />

      <H2>Mainnet</H2>
      <P>
        Everything targets Fuji unless told otherwise. A mainnet transaction (
        <C>chain: "c-chain"</C>), whether a deploy or a contract call, needs three things, and the
        tool refuses unless all of them are there:
      </P>
      <UL>
        <li>
          your own key in <C>AVAKIT_DEPLOYER_KEY</C> (the session test wallet is never used on
          mainnet),
        </li>
        <li>
          <C>confirm: true</C> in the tool call, and
        </li>
        <li>
          <C>AVAKIT_ALLOW_MAINNET=1</C> in the environment the server itself was started with.
        </li>
      </UL>
      <P>
        The last gate is out-of-band on purpose. A prompt-injected instruction can talk an agent
        into passing <C>confirm: true</C>, but it cannot set an environment variable on the machine
        that runs the server, so a prompt alone can never spend real funds. Set it where your MCP
        client configures the server, next to the key:
      </P>
      <CodeBlock code={MAINNET_CONFIG} />
      <P>
        Leave <C>AVAKIT_ALLOW_MAINNET</C> unset for everyday work: Fuji needs none of this, and a
        mainnet call then fails with a message that names the variable. A mainnet transaction spends
        real AVAX from that key, so give it a dedicated key that holds only what the work needs.{" "}
        <C>write_contract</C> never sends AVAX with a mainnet call, and from 0.3.0 it is held to the
        write limits there as on Fuji.
      </P>

      <H2>Where projects are created</H2>
      <P>
        <C>scaffold_app</C> creates the project inside the directory the server was started in — in
        Claude Code and Cursor, your workspace — and refuses a path outside it, so an agent acting
        on a malicious prompt cannot plant files elsewhere on your disk. Set <C>AVAKIT_MCP_ROOT</C>{" "}
        to use another directory.
      </P>

      <H2>Environment variables</H2>
      <P>
        All optional, and all read from the environment of the server process. None of them can be
        set by a tool call.
      </P>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Variable</th>
              <th className="px-4 py-2 text-left font-medium">What it does</th>
            </tr>
          </thead>
          <tbody>
            {ENVIRONMENT.map((variable) => (
              <tr key={variable.name} className="border-t">
                <td className="px-4 py-2 align-top">
                  <code className="font-mono text-xs">{variable.name}</code>
                </td>
                <td className="text-muted-foreground px-4 py-2">{variable.does}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2>Next to the official MCP server</H2>
      <P>
        Avalanche's official MCP server is read-only: it looks up documentation and on-chain data
        and never signs a transaction. <C>@avakit/mcp</C> also changes things. It writes a project
        to your disk and, on the Fuji testnet, deploys contracts and sends contract calls, behind
        the gates described above. The two do different jobs and can be used together.
      </P>

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
