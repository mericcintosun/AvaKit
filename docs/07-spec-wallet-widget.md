# 07 — Spec: `@avakit/react` (`<ConnectAvalanche>`)

> **Historical planning document** — written before implementation. AvaKit has since shipped (published on npm, 8 templates, live website); treat the root `README.md` and the website docs as the current source of truth.

**Role:** A **drop-in** social-login wallet + AvaKit hooks for the EVM developer's existing dapp.
**Milestone:** M1.
**Depends on:** `@avakit/core`, `wagmi`, `viem`, **shadcn/ui** (the only UI library), Framer Motion (animation), `next-themes` (theming).

> Design constraints ([doc 11](11-conventions.md)): UI is shadcn-only; black/white; dark/light from the start; BuilderKit UI is not used.

## Target DX

```tsx
// app/providers.tsx
import { AvaKitProvider } from '@avakit/react'
import { fuji } from '@avakit/core/chains'

export function Providers({ children }) {
  return (
    <AvaKitProvider
      chains={[fuji]}
      wallet={{ provider: 'web3auth', clientId: process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID! }}
    >
      {children}
    </AvaKitProvider>
  )
}
```

```tsx
// any component
import { ConnectAvalanche, useAvaAccount } from '@avakit/react'

export function Header() {
  const { address, isConnected } = useAvaAccount()
  return <ConnectAvalanche />   // Google/Apple/email modal + account card when connected
}
```

Two lines: wrap the provider + drop in the button. Result: a Fuji-connected dapp with social login.

## Components

### `<AvaKitProvider>`
Props:
- `chains: AvaChain[]` — supported chains (default is the first element).
- `wallet: { provider: 'web3auth' | 'avacloud' | 'injected'; clientId?: string; ...providerOpts }`
- `theme?` — light/dark/custom.
- Internally: wagmi `WagmiProvider` + viem config + puts the selected `WalletAdapter` into context.

### `<ConnectAvalanche>`
- When not connected: "Connect" → social-login modal (Web3Auth). Google/Apple/email/injected options.
- When connected: truncated address, chain badge, balance, disconnect.
- Props: `label?`, `chainSelector?: boolean`, `onConnect?`, `onDisconnect?`.
- All visual primitives are built on **shadcn/ui** (Dialog, Button, DropdownMenu, Avatar, Badge); black/white tokens; modal transitions via Framer Motion.

### `<ChainSelector>` (based on shadcn DropdownMenu)
- Switch between supported chains; custom L1 supported. Built with shadcn `DropdownMenu` + `Command`.

## Hooks

| Hook | Returns |
|---|---|
| `useAvaAccount()` | `{ address, isConnected, isConnecting }` |
| `useAvaChain()` | `{ chain, switchChain(id) }` |
| `useContract({ address, abi })` | typed `read` / `write` helpers |
| `useAvaDeploy()` | `{ deploy(artifact, args), status, result }` |
| `useBalance(addr?)` | `{ data: bigint, isLoading }` |

- The hooks bind `@avakit/core` functions to React state; most are a thin wrapper over wagmi.

## UI library: shadcn-only (critical)
- Per the project rule ([doc 11](11-conventions.md)), all components are built on **shadcn/ui** primitives. BuilderKit UI is **not used**.
- Advantage: a single design language, full control (black/white + theme-first), AI ergonomics (the agent produces a single pattern), no vendor lock-in.
- Trade-off: we build the Avalanche-specific components (connect, chain selector) ourselves; we accept overlapping with Ava Labs BuilderKit.

## Style & theme
- **Tailwind v4 + shadcn tokens.** **Black/white only** until M3 is done.
- **Dark/light from the very start** via `next-themes`; every component is tested in both themes.
- Animation: **Framer Motion** (modal/state transitions).
- A headless variant may be considered (M2+), but M1 is pre-styled (shadcn defaults, colorless).

## SSR / Next.js notes
- `<AvaKitProvider>` is a client component (`'use client'`).
- The Web3Auth SDK loads only on the client (dynamic import / `ssr: false`).
- Hydration-safe: connection state is read after mount.

## Acceptance criteria (M1)
- Add `@avakit/react` to an empty `create-next-app` and, in 2 lines, get Google login + balance + 1 tx on Fuji — **< 5 min.**

Related: [Core Spec](06-spec-core-sdk.md) · [Scaffolder Spec](08-spec-scaffolder.md) · [ADR-003](04-adr.md)
