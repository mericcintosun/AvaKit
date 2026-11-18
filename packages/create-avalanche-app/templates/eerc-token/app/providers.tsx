"use client";

import {
  type WalletAdapter,
  burnerAdapter,
  injectedAdapter,
  isMainnet,
  toViemChain,
} from "@avakit/core";
import { __CHAIN_CONST__ } from "@avakit/core/chains";
import { web3authAdapter } from "@avakit/core/web3auth";
import { AvaKitProvider } from "@avakit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useMemo, useState } from "react";
import { WagmiProvider, http, createConfig } from "wagmi";

// Shared AvaKit demo Web3Auth client ID so social login works with zero setup on
// localhost. It is a Sapphire Devnet project that only allows localhost origins,
// so it is only ever used on a testnet — replace it with your own (free at
// dashboard.web3auth.io) before deploying.
const DEMO_WEB3AUTH_CLIENT_ID =
  "BI14QqLFixs0HxS-XPTpHav_oVgLsntWv54Tjz69ruuqP5NP8rdcc0yl1CUKdlu9Nk--sKdQUVV7mOz41lsnhmg";

// A mainnet app moves real funds, so it gets the production wallet setup: no
// temporary in-browser wallet, Web3Auth's Sapphire Mainnet instead of its devnet,
// and no fallback to the shared demo client ID.
const ON_MAINNET = isMainnet(__CHAIN_CONST__);

export function Providers({ children }: { children: ReactNode }) {
  const adapters = useMemo(() => {
    const list: WalletAdapter[] = [];
    // Social login. On a testnet it works out of the box on localhost via the
    // bundled demo key, and NEXT_PUBLIC_WEB3AUTH_CLIENT_ID overrides it (set your
    // own for deployment). On mainnet there is no fallback: until you set your
    // own Sapphire Mainnet client ID the option is listed but disabled, with the
    // reason shown under it.
    const clientId =
      process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID || (ON_MAINNET ? "" : DEMO_WEB3AUTH_CLIENT_ID);
    const social = web3authAdapter({
      clientId,
      chains: [__CHAIN_CONST__],
      network: ON_MAINNET ? "sapphire_mainnet" : "sapphire_devnet",
    });
    list.push(
      clientId
        ? social
        : {
            ...social,
            unavailableReason:
              "Social login on mainnet needs your own Web3Auth client ID from a Sapphire Mainnet " +
              "project (dashboard.web3auth.io). Set NEXT_PUBLIC_WEB3AUTH_CLIENT_ID in .env.local.",
          },
    );
    // Injected (Core / MetaMask) is always available.
    list.push(injectedAdapter());
    // Zero-config fallback, testnets only: a temporary in-browser wallet so a new
    // user can try everything with no setup. Its key sits in localStorage in the
    // clear, so it is never offered on mainnet (the adapter refuses to connect
    // there anyway). The wallets above are the bring-your-own upgrade.
    if (!ON_MAINNET) {
      list.push(burnerAdapter({ chain: __CHAIN_CONST__ }));
    }
    return list;
  }, []);

  // The eERC SDK's read hooks (balance/state) are built on wagmi + react-query
  // internally, so this template runs a wagmi config alongside AvaKitProvider
  // purely to satisfy those reads. Wallet connect/sign still goes through
  // AvaKitProvider's adapters (Web3Auth / injected) — wagmi never owns the
  // account here, it only provides an RPC-backed read client. Derive the wagmi
  // chain from the same __CHAIN_CONST__ AvaKit uses, so the two never diverge.
  // (The shared eERC contract in lib/eerc-config.ts only exists on Fuji — deploy
  // your own instance to use another chain; see CLAUDE.md.)
  const [wagmiConfig] = useState(() => {
    const viemChain = toViemChain(__CHAIN_CONST__);
    return createConfig({
      chains: [viemChain],
      transports: { [viemChain.id]: http(__CHAIN_CONST__.rpcUrl) },
    });
  });
  const [queryClient] = useState(() => new QueryClient());

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <AvaKitProvider chains={[__CHAIN_CONST__]} adapters={adapters}>
            {children}
          </AvaKitProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
