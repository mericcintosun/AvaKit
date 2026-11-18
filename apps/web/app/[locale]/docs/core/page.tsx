import type { Metadata } from "next";

import { CodeBlock } from "@/components/code-block";
import { A, C, DocHeader, H2, NextLinks, Note, P, UL } from "@/components/docs/prose";
import { InstallTabs } from "@/components/install-tabs";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  route: "/docs/core",
  title: "@avakit/core",
  description:
    "The framework-agnostic AvaKit kernel: chains, wallet adapters, deploy, and chain data.",
});

export default function CoreDocs() {
  return (
    <>
      <DocHeader
        title="@avakit/core"
        lead="The framework-agnostic kernel. Depends only on viem. With a real wallet, private keys never leave the wallet provider; the temporary burner wallet is the one deliberate exception."
      />

      <H2>Install</H2>
      <InstallTabs pkg="@avakit/core viem" />
      <Note>
        <C>@avakit/core</C> is <strong>ESM-only</strong> — use <C>import</C>, not <C>require</C>. In
        a CommonJS file, load it with a dynamic <C>await import("@avakit/core")</C>. Requires Node{" "}
        <C>&gt;= 20.11</C>; AvaKit is tested on Node 22 and 24.
      </Note>

      <H2>Chains</H2>
      <P>
        Built-in chains and a helper for custom Avalanche L1s, from <C>@avakit/core/chains</C>:
      </P>
      <CodeBlock
        code={`import { fuji, cChain, defineChain } from "@avakit/core/chains";

const myL1 = defineChain({
  id: 99999,
  name: "My L1",
  rpcUrl: "https://my-l1.example/rpc",
  explorerUrl: "https://explorer.example",
  nativeCurrency: { name: "Token", symbol: "TKN", decimals: 18 },
  testnet: true,
});`}
      />
      <P>
        The built-in chains link to the Builder Hub explorer (<C>fuji.explorerUrl</C>,{" "}
        <C>cChain.explorerUrl</C>). AvaKit builds explorer links by appending{" "}
        <C>/tx/&lt;hash&gt;</C> or <C>/address/&lt;address&gt;</C> to <C>explorerUrl</C>, and leaves
        them out for a chain whose <C>explorerUrl</C> is empty, such as a fresh L1.
      </P>

      <H2>Wallet adapters</H2>
      <P>
        Adapters expose an EIP-1193 provider behind a common interface, so the rest of AvaKit treats
        every wallet the same way:
      </P>
      <UL>
        <li>
          <C>burnerAdapter()</C>: a temporary in-browser wallet with no setup at all, wired into
          every template. Testnet only; read the warning below before you use it.
        </li>
        <li>
          <C>injectedAdapter()</C>: Core, MetaMask, and other browser wallets.
        </li>
        <li>
          <C>web3authAdapter()</C> (from <C>@avakit/core/web3auth</C>): social login.
        </li>
        <li>
          <C>coinbaseAdapter()</C> (from <C>@avakit/core/coinbase</C>): a passkey smart wallet.
        </li>
      </UL>
      <CodeBlock
        code={`import { burnerAdapter, injectedAdapter } from "@avakit/core";
import { fuji } from "@avakit/core/chains";
import { web3authAdapter } from "@avakit/core/web3auth";

const burner = burnerAdapter({ chain: fuji });
const injected = injectedAdapter();
const social = web3authAdapter({ clientId: process.env.WEB3AUTH_CLIENT_ID! });

const { address, provider } = await social.connect();`}
      />
      <Note>
        <C>@web3auth/modal</C> and <C>@coinbase/wallet-sdk</C> are optional peer dependencies;
        install one only if you use its adapter. Get a free Web3Auth client ID at{" "}
        <A href="https://dashboard.web3auth.io">dashboard.web3auth.io</A>.
      </Note>
      <Note>
        <strong>
          The burner wallet is the one place this package creates and stores a private key.
        </strong>{" "}
        <C>burnerAdapter()</C> generates a throwaway key in the browser and, by default, keeps it in{" "}
        <C>localStorage</C> in the clear (<C>avakit.burner.pk</C>), where any script running on the
        page can read it. That is the intended trade-off for a testnet identity holding a faucet
        drip, and nothing else: it refuses to connect on mainnet, and you should never send real
        funds to a burner address. <C>clearBurner()</C> deletes the key, and <C>persist: false</C>{" "}
        keeps it in memory only. With every other adapter the key is generated, stored, and used
        inside the wallet provider, and AvaKit only ever sees a signing interface.
      </Note>

      <H2>Clients & network</H2>
      <CodeBlock
        code={`import { getPublicClient, getWalletClient, ensureChain, fuji } from "@avakit/core";

const publicClient = getPublicClient(fuji);
await ensureChain(provider, fuji);          // add + switch the wallet's chain
const wallet = getWalletClient(fuji, provider);`}
      />

      <H2>Deploy & data</H2>
      <CodeBlock
        code={`import { deployContract, getBalance, readContract, fuji } from "@avakit/core";

const balance = await getBalance("0x…", fuji);

const { address, txHash, explorerUrl } = await deployContract({
  artifact: { abi, bytecode },
  chain: fuji,
  provider,
  account: "0x…",
});`}
      />
      <P>
        <C>deployContract</C> resolves only when the contract exists: the deployment transaction
        succeeded, its receipt names a contract address, and code was read back from that address
        (the read is repeated for about two seconds, because an RPC node can lag behind the one that
        served the receipt). Anything else rejects with <C>DeployFailedError</C>: a reverted
        transaction, a receipt without an address, or an address that holds no code.{" "}
        <C>explorerUrl</C> is an empty string on a chain that has no explorer.
      </P>
      <P>
        On a mainnet chain <C>deployContract</C> refuses with <C>MainnetConfirmationError</C> unless
        you pass <C>confirmMainnet: true</C>, and with the flag set it still checks the account's
        balance against the estimated cost before anything is sent (<C>InsufficientFundsError</C>).
        A chain counts as a mainnet unless its definition says <C>testnet: true</C>, and chain id
        43114 always counts as one.
      </P>
      <P>
        When your own code sends the creation transaction (a script or a server signing with its own
        account), <C>waitForDeployment</C> applies the same definition of deployed to a transaction
        hash:
      </P>
      <CodeBlock
        code={`import { waitForDeployment, fuji } from "@avakit/core";

// Rejects with DeployFailedError unless the contract's code is on chain.
const { address, explorerUrl } = await waitForDeployment(txHash, fuji);`}
      />

      <H2>Test funds</H2>
      <P>
        <C>requestFaucet</C> asks an AvaKit faucet (the Worker in <C>services/faucet</C>) to send
        test AVAX to an address, and rejects with <C>FaucetError</C> when the faucet refuses or
        cannot be reached. <C>AVAKIT_FAUCET_URL</C> is AvaKit's shared Fuji faucet: one small drip
        per address per day, rate-limited, and meant for first runs only. Nothing in this package
        uses it implicitly — you pass the URL yourself — and anything beyond a first run should use
        a faucet of your own.
      </P>
      <CodeBlock
        code={`import { AVAKIT_FAUCET_URL, FaucetError, requestFaucet, fuji } from "@avakit/core";

try {
  const { txHash } = await requestFaucet({
    url: AVAKIT_FAUCET_URL,
    address: "0x…",
    chainId: fuji.id,
  });
} catch (error) {
  if (error instanceof FaucetError) {
    // error.code: "rate_limited" | "empty" | "invalid" | "unavailable" | "network"
    console.error(error.code, error.message);
  }
}`}
      />
      <P>
        A failure that may be temporary is retried inside <C>requestFaucet</C>, so what reaches your
        code is either a drip or a failure worth showing. The options, all optional:
      </P>
      <UL>
        <li>
          <C>retries</C>: how many times to try again after a temporary failure. Default 2, so at
          most three attempts; <C>0</C> turns retries off. A refusal is never retried.
        </li>
        <li>
          <C>retryDelayMs</C>: the base of the wait between attempts. Default 800; the wait is
          random within a window that doubles after every failure, up to 30 seconds.
        </li>
        <li>
          <C>timeoutMs</C>: how long one attempt may take. Default 10,000; <C>0</C> turns the limit
          off.
        </li>
        <li>
          <C>signal</C>: an <C>AbortSignal</C> that stops the request and any retry still to come.
        </li>
        <li>
          <C>turnstileToken</C>: a Cloudflare Turnstile token for a faucet that asks for one, as a
          string or as a function that is called before every attempt (a token can be used once).
        </li>
      </UL>
      <P>
        A <C>FaucetError</C> carries the faucet's own message plus fields for code to branch on:
      </P>
      <UL>
        <li>
          <C>code</C>: <C>"rate_limited"</C> (this address or network was funded recently),{" "}
          <C>"empty"</C> (the faucet has run out), <C>"invalid"</C> (the request was refused and
          sending it again will not help), <C>"unavailable"</C> (the faucet failed on its side) or{" "}
          <C>"network"</C> (no answer arrived: unreachable, timed out or aborted).
        </li>
        <li>
          <C>retryable</C>: true for <C>"unavailable"</C> and <C>"network"</C>, the only failures{" "}
          <C>requestFaucet</C> retries.
        </li>
        <li>
          <C>retryAfterMs</C>: how long the faucet asked the caller to wait, when it said.
        </li>
        <li>
          <C>faucetCode</C>: the faucet's own, more specific refusal code, when its answer carried
          one (for example <C>"address_limited"</C>).
        </li>
        <li>
          <C>status</C>: the HTTP status of the faucet's answer; undefined when none arrived.
        </li>
      </UL>
      <P>
        A chain's <C>faucetUrl</C> (for example <C>fuji.faucetUrl</C>) is something else: a faucet
        page to link people to, not an endpoint to call. For Fuji it is the Builder Hub faucet,
        which needs a free Builder Hub sign-in.
      </P>

      <H2>Chain data (Data API)</H2>
      <P>
        Indexed, read-only balances, NFT holdings, and transaction history from the AvaCloud Data
        API — no indexer to run. Each helper takes the address and the chain, which can be an{" "}
        <C>AvaChain</C> (like <C>fuji</C>) or a raw EVM chain id (<C>43113</C> Fuji, <C>43114</C>{" "}
        C-Chain).
      </P>
      <CodeBlock
        code={`import { getNativeBalance, listNfts, fuji } from "@avakit/core";

const native = await getNativeBalance("0x…", fuji);   // or: getNativeBalance("0x…", 43113)
const nfts = await listNfts("0x…", fuji);`}
      />

      <H2>API surface</H2>
      <UL>
        <li>
          <C>fuji</C>, <C>cChain</C>, <C>defineChain</C> (from <C>/chains</C>)
        </li>
        <li>
          <C>burnerAdapter</C>, <C>clearBurner</C>, <C>injectedAdapter</C>, <C>web3authAdapter</C>{" "}
          (from <C>/web3auth</C>), <C>coinbaseAdapter</C> (from <C>/coinbase</C>)
        </li>
        <li>
          <C>getPublicClient</C>, <C>getWalletClient</C>, <C>toViemChain</C>, <C>ensureChain</C>
        </li>
        <li>
          <C>deployContract</C>, <C>waitForDeployment</C>, <C>getBytecode</C>, <C>getBalance</C>,{" "}
          <C>getTransactionReceipt</C>, <C>readContract</C>
        </li>
        <li>
          <C>getNativeBalance</C>, <C>listErc20Balances</C>, <C>listNfts</C>,{" "}
          <C>listTransactions</C> (AvaCloud Data API, keyless)
        </li>
        <li>
          <C>requestFaucet</C>, <C>AVAKIT_FAUCET_URL</C>, <C>FaucetError</C> (test funds)
        </li>
      </UL>

      <NextLinks
        items={[
          {
            label: "@avakit/react",
            href: "/docs/react",
            description: "Use core from React with hooks and a widget.",
          },
          {
            label: "create-avalanche-app",
            href: "/docs/cli",
            description: "Scaffold an app that wires this up for you.",
          },
        ]}
      />
    </>
  );
}
