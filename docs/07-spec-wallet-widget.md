# 07 — Spec: `@avakit/react` (`<ConnectAvalanche>`)

**Rol:** EVM dev'in mevcut dapp'ine **drop-in** social-login cüzdan + AvaKit hook'ları.
**Milestone:** M1.
**Bağımlı:** `@avakit/core`, `wagmi`, `viem`, **shadcn/ui** (tek UI kütüphanesi), Framer Motion (animasyon), `next-themes` (tema).

> Tasarım kısıtları ([doc 11](11-conventions.md)): UI sadece shadcn; siyah/beyaz; dark/light baştan; BuilderKit UI kullanılmaz.

## Hedef DX

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
// herhangi bir component
import { ConnectAvalanche, useAvaAccount } from '@avakit/react'

export function Header() {
  const { address, isConnected } = useAvaAccount()
  return <ConnectAvalanche />   // Google/Apple/email modal'ı + bağlı durumda hesap kartı
}
```

İki satır: provider sar + butonu koy. Sonuç: social-login'li, Fuji'ye bağlı dapp.

## Bileşenler

### `<AvaKitProvider>`
Props:
- `chains: AvaChain[]` — desteklenen zincirler (default ilk eleman).
- `wallet: { provider: 'web3auth' | 'avacloud' | 'injected'; clientId?: string; ...providerOpts }`
- `theme?` — açık/koyu/özel.
- İçeride: wagmi `WagmiProvider` + viem config + seçilen `WalletAdapter`'ı context'e koyar.

### `<ConnectAvalanche>`
- Bağlı değilse: "Connect" → social-login modal (Web3Auth). Google/Apple/email/injected seçenekleri.
- Bağlıysa: kısaltılmış adres, zincir rozeti, bakiye, disconnect.
- Props: `label?`, `chainSelector?: boolean`, `onConnect?`, `onDisconnect?`.
- Tüm görsel primitive'ler **shadcn/ui** (Dialog, Button, DropdownMenu, Avatar, Badge) üstüne kurulur; siyah/beyaz token'lar; modal geçişleri Framer Motion ile.

### `<ChainSelector>` (shadcn DropdownMenu tabanlı)
- Desteklenen zincirler arası geçiş; custom L1 destekli. shadcn `DropdownMenu` + `Command` ile.

## Hooks

| Hook | Döndürür |
|---|---|
| `useAvaAccount()` | `{ address, isConnected, isConnecting }` |
| `useAvaChain()` | `{ chain, switchChain(id) }` |
| `useContract({ address, abi })` | tipli `read` / `write` yardımcıları |
| `useAvaDeploy()` | `{ deploy(artifact, args), status, result }` |
| `useBalance(addr?)` | `{ data: bigint, isLoading }` |

- Hook'lar `@avakit/core` fonksiyonlarını React state'e bağlar; çoğu wagmi üstüne ince sarma.

## UI kütüphanesi: shadcn-only (kritik)
- Proje kuralı gereği ([doc 11](11-conventions.md)) tüm bileşenler **shadcn/ui** primitive'leri üstüne kurulur. BuilderKit UI **kullanılmaz**.
- Avantaj: tek tasarım dili, tam kontrol (siyah/beyaz + tema-öncelikli), AI-ergonomi (ajan tek pattern üretir), vendor lock-in yok.
- Trade-off: Avalanche-spesifik bileşenleri (connect, chain selector) kendimiz kuruyoruz; Ava Labs BuilderKit ile çakışmayı kabul ediyoruz.

## Stil & tema
- **Tailwind v4 + shadcn token'ları.** M3 bitene kadar **sadece siyah/beyaz**.
- **Dark/light en baştan** `next-themes` ile; her bileşen iki temada da test edilir.
- Animasyon: **Framer Motion** (modal/durum geçişleri).
- Headless varyant düşünülebilir (M2+), ama M1 hazır-stilli (shadcn default'ları, renksiz).

## SSR / Next.js notları
- `<AvaKitProvider>` client component (`'use client'`).
- Web3Auth SDK yalnızca client'ta yüklenir (dynamic import / `ssr: false`).
- Hidrasyon güvenli: bağlantı durumu mount sonrası okunur.

## Kabul kriteri (M1)
- Boş `create-next-app`'e `@avakit/react` eklenip 2 satırla Fuji'de Google login + bakiye + 1 tx — **< 5 dk.**

İlgili: [Core Spec](06-spec-core-sdk.md) · [Scaffolder Spec](08-spec-scaffolder.md) · [ADR-003](04-adr.md)
