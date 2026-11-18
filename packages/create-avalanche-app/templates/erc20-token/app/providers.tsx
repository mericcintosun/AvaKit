"use client";

import {
  AVAKIT_FAUCET_URL,
  type WalletAdapter,
  burnerAdapter,
  injectedAdapter,
  isMainnet,
} from "@avakit/core";
import { __CHAIN_CONST__ } from "@avakit/core/chains";
import { web3authAdapter } from "@avakit/core/web3auth";
import { AvaKitProvider } from "@avakit/react";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useMemo } from "react";

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

// Test AVAX for a first run. A brand-new wallet holds nothing, so it cannot pay
// for its first transaction; a faucet sends it a little test AVAX to start with.
//
// AVAKIT_FAUCET_URL (from @avakit/core) is AvaKit's shared Fuji faucet: a
// rate-limited convenience for first runs, paid for by the AvaKit maintainer.
// It gives one small drip per address per day (and caps how many one IP address
// can take in an hour), so a freshly scaffolded app works with no account
// anywhere. It is not something to build a product on: it can be empty, it can
// refuse, and it can change.
//
// Run your own before you ship. The faucet is a small Cloudflare Worker, and
// its source and guide are in services/faucet of the AvaKit repository
// (https://github.com/mericcintosun/AvaKit/tree/main/services/faucet). Put its
// /fund URL in NEXT_PUBLIC_AVAKIT_FAUCET_URL (.env.local), or set that variable
// to "off" and the app asks no faucet at all.

// Fuji's chain id — the only chain a faucet is ever asked on (see below).
const FUJI_CHAIN_ID = 43113;

/**
 * The faucet this app asks for test AVAX, or undefined for none.
 *
 * Fuji only: the faucet serves no other chain, and an app on a mainnet must
 * never ask anyone for funds — there, a wallet is funded by its owner.
 */
function resolveFaucetUrl(): string | undefined {
  if (ON_MAINNET || __CHAIN_CONST__.id !== FUJI_CHAIN_ID) return undefined;
  const setting = process.env.NEXT_PUBLIC_AVAKIT_FAUCET_URL?.trim();
  if (!setting) return AVAKIT_FAUCET_URL;
  if (setting.toLowerCase() === "off") return undefined;
  try {
    const { protocol } = new URL(setting);
    if (protocol === "https:" || protocol === "http:") return setting;
  } catch {
    // Not a URL at all: reported below, like any other value that is not one.
  }
  console.warn(
    `NEXT_PUBLIC_AVAKIT_FAUCET_URL must be an http(s) URL or "off", but it is "${setting}". ` +
      "No faucet is asked until it is fixed.",
  );
  return undefined;
}

const FAUCET_URL = resolveFaucetUrl();

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

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AvaKitProvider chains={[__CHAIN_CONST__]} adapters={adapters} faucetUrl={FAUCET_URL}>
        {children}
      </AvaKitProvider>
    </ThemeProvider>
  );
}
