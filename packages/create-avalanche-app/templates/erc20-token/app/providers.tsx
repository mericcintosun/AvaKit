"use client";

import { type WalletAdapter, injectedAdapter } from "@avakit/core";
import { __CHAIN_CONST__ } from "@avakit/core/chains";
import { web3authAdapter } from "@avakit/core/web3auth";
import { AvaKitProvider } from "@avakit/react";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useMemo } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const adapters = useMemo(() => {
    const list: WalletAdapter[] = [];
    // Social login appears only when a Web3Auth client ID is configured.
    const clientId = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID;
    if (clientId) {
      list.push(web3authAdapter({ clientId }));
    }
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
