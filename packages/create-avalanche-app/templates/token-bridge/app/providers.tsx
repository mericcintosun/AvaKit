"use client";

import { burnerAdapter, injectedAdapter, type WalletAdapter } from "@avakit/core";
import { AvaKitProvider } from "@avakit/react";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useMemo } from "react";
import { homeChain, remoteChain } from "@/lib/ictt";

export function Providers({ children }: { children: ReactNode }) {
  // Local devnet: connect a browser wallet (Core / MetaMask) with the imported
  // EWOQ dev key. Both local L1s are registered so the app can switch between
  // them to bridge and read balances on each.
  // A temporary in-browser wallet is offered too (zero setup); on a local devnet
  // fund it from the EWOQ key or use injected, since the burner starts empty.
  const adapters = useMemo<WalletAdapter[]>(
    () => [injectedAdapter(), burnerAdapter({ chain: homeChain })],
    [],
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AvaKitProvider chains={[homeChain, remoteChain]} adapters={adapters}>
        {children}
      </AvaKitProvider>
    </ThemeProvider>
  );
}
