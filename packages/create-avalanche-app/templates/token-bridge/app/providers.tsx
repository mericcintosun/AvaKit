"use client";

import { injectedAdapter, type WalletAdapter } from "@avakit/core";
import { AvaKitProvider } from "@avakit/react";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useMemo } from "react";
import { homeChain, remoteChain } from "@/lib/ictt";

export function Providers({ children }: { children: ReactNode }) {
  // Local devnet: connect a browser wallet (Core / MetaMask) with the imported
  // EWOQ dev key. Both local L1s are registered so the app can switch between
  // them to bridge and read balances on each.
  const adapters = useMemo<WalletAdapter[]>(() => [injectedAdapter()], []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AvaKitProvider chains={[homeChain, remoteChain]} adapters={adapters}>
        {children}
      </AvaKitProvider>
    </ThemeProvider>
  );
}
