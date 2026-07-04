"use client";

import { type WalletAdapter, injectedAdapter } from "@avakit/core";
import { __CHAIN_CONST__ } from "@avakit/core/chains";
import { web3authAdapter } from "@avakit/core/web3auth";
import { AvaKitProvider } from "@avakit/react";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useMemo } from "react";

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

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AvaKitProvider chains={[__CHAIN_CONST__]} adapters={adapters}>
        {children}
      </AvaKitProvider>
    </ThemeProvider>
  );
}
