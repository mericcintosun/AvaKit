"use client";

import { injectedAdapter, type WalletAdapter } from "@avakit/core";
import { fuji } from "@avakit/core/chains";
import { web3authAdapter } from "@avakit/core/web3auth";
import { AvaKitProvider } from "@avakit/react";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useMemo } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const adapters = useMemo(() => {
    const list: WalletAdapter[] = [];
    // Social login (Web3Auth) appears only when a client ID is configured.
    const clientId = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID;
    if (clientId) {
      list.push(web3authAdapter({ clientId, network: "sapphire_devnet" }));
    }
    // Injected (Core / MetaMask) is always available — no API keys needed.
    list.push(injectedAdapter());
    return list;
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AvaKitProvider chains={[fuji]} adapters={adapters}>
        {children}
      </AvaKitProvider>
    </ThemeProvider>
  );
}
