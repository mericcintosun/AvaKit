import type { Metadata } from "next";

import { CodeBlock } from "@/components/code-block";
import { C, DocHeader, H2, NextLinks, Note, P, UL } from "@/components/docs/prose";
import { InstallTabs } from "@/components/install-tabs";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  route: "/docs/react",
  title: "@avakit/react",
  description: "React layer for AvaKit: <ConnectAvalanche> and hooks, built on shadcn/ui.",
});

export default function ReactDocs() {
  return (
    <>
      <DocHeader
        title="@avakit/react"
        lead="A drop-in wallet button with a chooser (temporary wallet, social login, browser wallet) and hooks, built on shadcn/ui."
      />

      <H2>Install</H2>
      <InstallTabs pkg="@avakit/react @avakit/core viem react react-dom" />

      <H2>Provider</H2>
      <P>
        Wrap your app in <C>&lt;AvaKitProvider&gt;</C> with the chains and wallet adapters you want:
      </P>
      <CodeBlock
        code={`"use client";
import { injectedAdapter } from "@avakit/core";
import { fuji } from "@avakit/core/chains";
import { AvaKitProvider } from "@avakit/react";

export function Providers({ children }) {
  return (
    <AvaKitProvider chains={[fuji]} adapters={[injectedAdapter()]}>
      {children}
    </AvaKitProvider>
  );
}`}
      />

      <H2>Connect button</H2>
      <CodeBlock
        code={`import { ConnectAvalanche, useAvaAccount } from "@avakit/react";

export function Header() {
  const { address, isConnected } = useAvaAccount();
  return <ConnectAvalanche />;
}`}
      />
      <P>
        The button opens a dialog with one entry per adapter you registered. With{" "}
        <C>burnerAdapter()</C> among them it leads with <strong>Start instantly</strong>, a
        temporary wallet that needs no setup, and lists the others under "already have a wallet?".
        The temporary wallet is testnet-only, so on a mainnet chain it is not offered.
      </P>
      <P>
        On connect, AvaKit automatically switches the wallet to the active chain (adding it if
        unknown), including embedded wallets, which default to a different network.
      </P>

      <H2>Test funds for the temporary wallet</H2>
      <P>
        A wallet that was just created has no gas. Pass <C>faucetUrl</C> to{" "}
        <C>&lt;AvaKitProvider&gt;</C> and the provider asks that faucet for a drip when a temporary
        wallet connects; <C>useFaucet()</C> exposes the same request for a "fund me" button and for
        showing why a request was refused. The scaffolded Fuji templates set this up for you with
        AvaKit's shared faucet, and <C>services/faucet</C> in the repository is the Worker to deploy
        when you want your own. The automatic drip only ever serves the temporary wallet, which
        cannot connect on a mainnet chain.
      </P>
      <CodeBlock
        code={`<AvaKitProvider
  chains={[fuji]}
  adapters={[burnerAdapter({ chain: fuji }), injectedAdapter()]}
  faucetUrl="https://your-faucet.example/fund"
>
  {children}
</AvaKitProvider>`}
      />

      <H2>Hooks</H2>
      <UL>
        <li>
          <C>useAvaAccount()</C>: <C>{"{ address, status, isConnected, isConnecting }"}</C>
        </li>
        <li>
          <C>useAvaChain()</C>: <C>{"{ chain, chains, setChain }"}</C>
        </li>
        <li>
          <C>useBalance(address?)</C>: <C>{"{ data, isLoading, error, refetch }"}</C>
        </li>
        <li>
          <C>useContract({"{ address, abi }"})</C>: <C>{"{ read, write }"}</C>
        </li>
        <li>
          <C>useAvaDeploy()</C>: <C>{"{ deploy, status, result, error }"}</C>
        </li>
        <li>
          <C>useSendTransaction()</C>:{" "}
          <C>{"{ send, reset, status, hash, error, explorerUrl, isPending }"}</C>
        </li>
        <li>
          <C>useFaucet()</C>: <C>{"{ fund, status, result, error, isFunding, enabled }"}</C>
        </li>
        <li>
          <C>useTokenBalances(address?)</C>: <C>{"{ native, tokens, isLoading, refetch }"}</C>
        </li>
        <li>
          <C>useNfts(address?)</C>: <C>{"{ nfts, isLoading, refetch }"}</C>
        </li>
        <li>
          <C>useTxHistory(address?)</C>: <C>{"{ transactions, isLoading, refetch }"}</C>
        </li>
        <li>
          <C>useAvaKit()</C>: the full context (provider, adapters, connect/disconnect)
        </li>
      </UL>

      <H2>Send a transaction</H2>
      <P>
        The <C>useSendTransaction</C> hook (and the <C>&lt;TransactionButton&gt;</C> component built
        on it) wrap the whole send flow: pending state, errors, and an explorer link.
      </P>
      <CodeBlock
        code={`import { TransactionButton, useSendTransaction } from "@avakit/react";
import { parseEther } from "viem";

// One-click component
<TransactionButton to="0x…" value={parseEther("0.01")}>Send 0.01 AVAX</TransactionButton>;

// Or the hook
const { send, isPending, explorerUrl } = useSendTransaction();
await send({ to: "0x…", value: parseEther("0.01") });`}
      />

      <H2>Read chain data (no indexer)</H2>
      <P>
        <C>useTokenBalances</C>, <C>useNfts</C>, and <C>useTxHistory</C> return indexed data from
        the AvaCloud Data API (balances, NFT holdings, and transaction history) with no indexer to
        run. They default to the connected account and active chain, and work keyless (pass{" "}
        <C>dataApiKey</C> to <C>&lt;AvaKitProvider&gt;</C> for higher rate limits).
      </P>
      <CodeBlock
        code={`import { useTokenBalances, useNfts, useTxHistory } from "@avakit/react";

const { native, tokens } = useTokenBalances();   // connected account
const { nfts } = useNfts();
const { transactions } = useTxHistory("0x…");     // or any address`}
      />

      <H2>Deploy & mint from React</H2>
      <CodeBlock
        code={`import { useAvaDeploy, useContract } from "@avakit/react";

const { deploy } = useAvaDeploy();
const { address } = await deploy({ abi, bytecode });

const nft = useContract({ address, abi });
await nft.write("mint", []);
const total = await nft.read("totalSupply");`}
      />

      <Note>
        Components are shadcn-styled (Radix + Tailwind tokens). Your app needs Tailwind configured
        with shadcn tokens; the scaffolder sets this up for you.
      </Note>

      <NextLinks
        items={[
          {
            label: "@avakit/core",
            href: "/docs/core",
            description: "The kernel these hooks build on.",
          },
          { label: "Templates", href: "/templates", description: "See it wired up end-to-end." },
        ]}
      />
    </>
  );
}
