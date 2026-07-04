"use client";

import { type WalletAdapter, injectedAdapter, toViemChain } from "@avakit/core";
import { __CHAIN_CONST__ } from "@avakit/core/chains";
import { web3authAdapter } from "@avakit/core/web3auth";
import { AvaKitProvider } from "@avakit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useMemo, useState } from "react";
import { WagmiProvider, http, createConfig } from "wagmi";

// Shared AvaKit demo Web3Auth client ID so social login works with zero setup on
// localhost. It only allows localhost origins — replace it with your own (free at
// dashboard.web3auth.io) before deploying.
const DEMO_WEB3AUTH_CLIENT_ID =
  "BI14QqLFixs0HxS-XPTpHav_oVgLsntWv54Tjz69ruuqP5NP8rdcc0yl1CUKdlu9Nk--sKdQUVV7mOz41lsnhmg";

export function Providers({ children }: { children: ReactNode }) {
  const adapters = useMemo(() => {
    const list: WalletAdapter[] = [];
    // Social login works out of the box on localhost via the bundled demo key;
    // NEXT_PUBLIC_WEB3AUTH_CLIENT_ID overrides it (set your own for deployment).
    list.push(
      web3authAdapter({
        clientId: process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID || DEMO_WEB3AUTH_CLIENT_ID,
        chains: [__CHAIN_CONST__],
      }),
    );
    // Injected (Core / MetaMask) is always available.
    list.push(injectedAdapter());
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
