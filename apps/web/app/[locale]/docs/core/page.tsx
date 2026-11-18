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
        <C>&gt;= 20.11</C>.
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
        <strong>The burner wallet is the one place AvaKit itself handles a private key.</strong>{" "}
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
          <C>deployContract</C>, <C>getBytecode</C>, <C>getBalance</C>, <C>getTransactionReceipt</C>
          , <C>readContract</C>
        </li>
        <li>
          <C>getNativeBalance</C>, <C>listErc20Balances</C>, <C>listNfts</C>,{" "}
          <C>listTransactions</C> (AvaCloud Data API, keyless)
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
