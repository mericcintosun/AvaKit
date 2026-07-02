"use client";

import { injectedAdapter, type WalletAdapter } from "@avakit/core";
import { AvaKitProvider } from "@avakit/react";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useMemo } from "react";
import { chain } from "@/lib/l1";

export function Providers({ children }: { children: ReactNode }) {
  // Your L1: connect a browser wallet (Core / MetaMask). On local networks,
  // import the EWOQ dev key (printed by `pnpm l1`) — it's pre-funded on your
  // chain. On Fuji, use your own funded wallet.
  const adapters = useMemo<WalletAdapter[]>(() => [injectedAdapter()], []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AvaKitProvider chains={[chain]} adapters={adapters}>
        {children}
      </AvaKitProvider>
    </ThemeProvider>
  );
}
