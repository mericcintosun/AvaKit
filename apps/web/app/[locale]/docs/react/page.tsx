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
        <C>&lt;AvaKitProvider&gt;</C> and the provider asks that faucet for one drip when a
        temporary wallet connects on a testnet. It reads the balance first and leaves a wallet that
        already holds funds alone, and it never asks on a mainnet chain, where the temporary wallet
        cannot connect anyway. The scaffolded Fuji templates set this up for you with AvaKit's
        shared faucet, and <C>services/faucet</C> in the repository is the Worker to deploy when you
        want your own.
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
      <P>
        <C>useFaucet()</C> reads the state of that request, which is kept in the provider and shared
        by every component that calls the hook. The automatic drip and a manual <C>fund()</C> report
        through it in the same way, so one component can show "funding", the result, or the faucet's
        refusal for either:
      </P>
      <CodeBlock
        code={`import { useFaucet } from "@avakit/react";

function Funding() {
  const { status, error, fund, enabled } = useFaucet();
  if (!enabled) return null;                 // no faucetUrl, or a mainnet chain
  if (status === "funding") return <p>Getting test AVAX…</p>;
  if (status === "error") {
    return (
      <p>
        {error?.message} <button onClick={() => fund()}>Try again</button>
      </p>
    );
  }
  return null;
}`}
      />
      <UL>
        <li>
          <C>status</C> is <C>"idle"</C>, <C>"funding"</C>, <C>"success"</C> or <C>"error"</C>.{" "}
          <C>"success"</C> means the faucet sent the drip (<C>result.txHash</C>), not that it has
          arrived: keep reading the balance, for example with <C>useBalance()</C>, until it is above
          zero.
        </li>
        <li>
          <C>error</C> from the faucet is a <C>FaucetError</C> from <C>@avakit/core</C>, with a{" "}
          <C>code</C>, <C>retryable</C> and, when the faucet said so, <C>retryAfterMs</C>. A failure
          that may be temporary has already been retried (three attempts in all) before it shows up
          here.
        </li>
        <li>
          <C>fund(address?)</C> asks by hand, for the connected account or another address. It
          rejects with the error as well as recording it, and a call made while a request for the
          same address is in flight joins that request instead of sending a second one.
        </li>
        <li>
          <C>reset()</C> returns the state to <C>"idle"</C>, for example to dismiss an error. The
          state also reads <C>"idle"</C> again when the account or the chain changes.
        </li>
      </UL>
      <P>
        For a faucet that asks for a Cloudflare Turnstile token, pass <C>faucetToken</C> to the
        provider: a function that returns a token, or a promise of one. It is called before every
        faucet request, each retry included, because a token can be used only once.
      </P>

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
          <C>useFaucet()</C>: <C>{"{ fund, reset, status, result, error, isFunding, enabled }"}</C>
        </li>
        <li>
          <C>useTokenBalances(address?, {"{ pageSize }"}?)</C>: <C>{"{ native, tokens, … }"}</C>
        </li>
        <li>
          <C>useNfts(address?, {"{ pageSize }"}?)</C>: <C>{"{ nfts, … }"}</C>
        </li>
        <li>
          <C>useTxHistory(address?, {"{ pageSize }"}?)</C>: <C>{"{ transactions, … }"}</C>
        </li>
        <li>
          <C>useAvaKit()</C>: the full context (provider, adapters, connect/disconnect)
        </li>
      </UL>
      <P>
        The three data hooks also return{" "}
        <C>{"{ isLoading, error, refetch, hasMore, fetchMore, isFetchingMore, nextPageToken }"}</C>.
        The chain data section below shows how paging works. A hook that reads from the network
        reports a failed read through <C>error</C> instead of throwing.
      </P>

      <H2>Send a transaction</H2>
      <P>
        The <C>useSendTransaction</C> hook (and the <C>&lt;TransactionButton&gt;</C> component built
        on it) wrap the send flow: pending state, errors, and an explorer link.
      </P>
      <CodeBlock
        code={`import { TransactionButton, useSendTransaction } from "@avakit/react";
import { parseEther } from "viem";

// One-click component
<TransactionButton to="0x…" value={parseEther("0.01")}>Send 0.01 AVAX</TransactionButton>;

// Or the hook
const { send, isPending, explorerUrl } = useSendTransaction();
const hash = await send({ to: "0x…", value: parseEther("0.01") });`}
      />
      <Note>
        <C>status</C> becomes <C>"success"</C>, and <C>send()</C> resolves with the hash, as soon as
        the wallet has broadcast the transaction. Neither waits for it to be mined, so a transaction
        that later reverts is not reported here. <C>explorerUrl</C> is <C>null</C> on a chain
        without an explorer.
      </Note>
      <P>When the outcome matters, wait for the receipt and check its status:</P>
      <CodeBlock
        code={`import { getPublicClient } from "@avakit/core";
import { useAvaChain } from "@avakit/react";

const { chain } = useAvaChain();
const receipt = await getPublicClient(chain).waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error("The transaction reverted.");`}
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
      <P>
        The Data API answers one page at a time. Each hook loads the first page and reports{" "}
        <C>hasMore</C>; <C>fetchMore()</C> appends the next page, and <C>{"{ pageSize }"}</C>{" "}
        chooses how many items a page holds (the API caps it at 100). A failed request is reported
        through <C>error</C>.
      </P>
      <CodeBlock
        code={`const { transactions, error, hasMore, fetchMore, isFetchingMore } = useTxHistory(
  undefined,                // the connected account
  { pageSize: 25 },
);

{error ? <p>{error.message}</p> : null}
{hasMore ? (
  <button onClick={() => fetchMore()} disabled={isFetchingMore}>
    Load more
  </button>
) : null}`}
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
      <P>
        <C>deploy()</C> resolves, and <C>status</C> becomes <C>"success"</C>, only once the
        deployment transaction has succeeded and the contract's code has been read back from the
        chain; a deployment that reverted or left no code ends in <C>"error"</C>. <C>write()</C>{" "}
        resolves with the transaction hash when the wallet has broadcast the call, without waiting
        for it to be mined.
      </P>

      <H2>Server Components</H2>
      <P>
        <C>@avakit/react</C> is a Client Component module: it carries the <C>"use client"</C>{" "}
        directive, so a Server Component can render its components but cannot call a function
        imported from it. The pure helpers <C>cn</C>, <C>shortenAddress</C> and <C>humanizeError</C>{" "}
        are therefore also exported from <C>@avakit/react/utils</C>, an entry without the directive:
      </P>
      <CodeBlock
        code={`import { shortenAddress } from "@avakit/react/utils";

export default function Owner({ address }: { address: string }) {
  return <span>{shortenAddress(address)}</span>;
}`}
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
