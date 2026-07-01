# 03 — Mimari

## Temel ilke: 1 çekirdek, 3 yüzey

AvaKit üç ayrı ürün değildir; **tek çekirdeğin (`@avakit/core`) üç farklı tüketim yüzeyidir.** Bir şeyi çekirdekte iyi yaparsan üç yüzey birden iyileşir.

```
                  ┌──────────────────────────────────────┐
                  │           @avakit/core               │  ← KERNEL
                  │  • chain registry (Fuji/C-Chain/L1)  │
                  │  • viem public/wallet client         │
                  │  • WalletAdapter arayüzü             │
                  │      └─ Web3AuthAdapter (default)    │
                  │      └─ AvaCloudAdapter (opt-in)     │
                  │      └─ InjectedAdapter (Core/MM)    │
                  │  • deploy & contract helpers         │
                  │  • chain data okuma (RPC/Glacier)    │
                  └───────────────┬──────────────────────┘
                                  │ herkes bunu tüketir
        ┌─────────────────────────┼──────────────────────────┐
        ▼                         ▼                           ▼
┌────────────────┐      ┌───────────────────┐       ┌────────────────────┐
│ @avakit/react  │      │ create-avalanche- │       │   @avakit/mcp      │
│ <AvaKitProvider>│     │ app (CLI)         │       │  MCP server        │
│ <ConnectAva.../>│     │ • interaktif sihir│       │  • scaffold_app    │
│ hooks (useAva*) │     │ • template render │       │  • deploy_contract │
│ shadcn/ui UI    │     │ • AI context inj. │       │  • read_chain      │
└────────┬───────┘      └─────────┬─────────┘       │  • get_context     │
         │                        │                  └─────────┬──────────┘
         │ üretilen app içine     │ template'ler             │ çağırır
         └────────────────────────┴──────────────────────────┘
                          (scaffolder, @avakit/react + core içeren
                           çalışan bir Next.js app üretir; MCP de
                           aynı scaffolder'ı tool olarak sarar)
```

## Yüzeylerin sorumlulukları

### `@avakit/core` (kernel)
- **Chain registry:** Fuji, C-Chain mainnet, custom L1 tanımları (chainId, RPC, explorer, faucet).
- **Client factory:** viem `publicClient` / `walletClient` üretimi.
- **WalletAdapter arayüzü:** `connect()`, `disconnect()`, `getAddress()`, `signTransaction()` vb. Provider'ı soyutlar.
- **Deploy helpers:** Foundry artefact'ından bytecode/ABI okuyup deploy; tx bekleme; adres döndürme.
- **Data:** bakiye, tx, contract read (RPC; opsiyonel Glacier/AvaCloud data API).
- Framework-agnostic, sadece TypeScript. React'e bağımlı değil.

### `@avakit/react` (widget katmanı)
- `<AvaKitProvider>`: wagmi/viem config + seçilen WalletAdapter'ı context'e koyar.
- `<ConnectAvalanche>`: social-login default Connect butonu (Web3Auth modalı), bağlı durumda hesap/zincir göstergesi.
- Hooks: `useAvaAccount()`, `useAvaChain()`, `useAvaDeploy()`, `useContract()`.
- Tüm UI **shadcn/ui** primitive'leri üstüne kurulur (tek UI lib); `next-themes` ile dark/light, M3'e kadar siyah/beyaz. BuilderKit UI kullanılmaz (bkz. [Conventions](11-conventions.md)).

### `create-avalanche-app` (scaffolder)
- İnteraktif CLI (template, wallet provider, chain seçimi).
- Template render + dependency kurulumu + `.env.example` üretimi.
- **AI context enjeksiyonu:** üretilen projeye `CLAUDE.md`, `llms.txt`, `.cursor/rules` ekler.
- `@avakit/react` + `@avakit/core` kullanan, çalışan bir Next.js app çıkarır.

### `@avakit/mcp` (AI yüzeyi)
- MCP server (stdio). Claude Code / Cursor / Claude Desktop'a bağlanır.
- Tool'lar scaffolder + core'u sarar: `scaffold_app`, `deploy_contract`, `read_chain`, `get_context`.
- Resmi `llms.txt`'i tüketerek dokümantasyon bağlamı sağlar (kendi docs'unu yazmaz).

## Monorepo yapısı

```
avakit/  (repo)
├── apps/
│   └── docs/                 # dokümantasyon sitesi (sonra)
├── packages/
│   ├── core/                 # @avakit/core
│   ├── react/                # @avakit/react
│   ├── mcp/                  # @avakit/mcp
│   └── create-avalanche-app/ # CLI
├── templates/
│   ├── minimal/
│   ├── token-gated-app/
│   └── nft-mint/
├── examples/                 # canlı demo dapp'ler
└── docs/                     # bu planlama dokümanları (şu anki repo)
```

- **Monorepo aracı:** pnpm workspaces + Turborepo (bkz. [ADR-002](04-adr.md)).
- **Sürümleme:** Changesets.
- **Build:** tsup (paketler), Next.js (template/örnekler).

## Veri akışı: "social login ile ilk tx"

```
Kullanıcı  →  <ConnectAvalanche>  →  Web3AuthAdapter.connect()
                                          │  (Google OAuth → HSM-backed key)
                                          ▼
                                   viem walletClient  ←  @avakit/core
                                          │
                                          ▼
                                   Fuji RPC  →  tx gönderilir  →  explorer linki
```
Private key hiçbir zaman AvaKit kodundan geçmez; adapter yalnızca imzalama arayüzünü kullanır.

## Bağımlılık yönü (katı kural)

```
core  ──(bağımlı değil)──>  hiçbir yüzey
react ────────────────────>  core
cli   ────────────────────>  core, react (template aracılığıyla)
mcp   ────────────────────>  core, cli (scaffold için)
```
Çekirdek hiçbir yüzeye bağlı olamaz. Döngüsel bağımlılık yasak.

## Genişleme noktaları

- **Yeni wallet provider:** `WalletAdapter` implemente et, registry'e ekle. (Privy, Dynamic, Turnkey...)
- **Yeni template:** `templates/` altına klasör + manifest. CLI ve MCP otomatik görür.
- **Yeni chain/L1:** chain registry'e entry. Custom L1 için kullanıcı runtime'da ekleyebilir.
- **Yeni MCP tool:** `@avakit/mcp` içinde tool tanımı; core/cli'yi çağırır.

İlgili: [ADR](04-adr.md) · [Core Spec](06-spec-core-sdk.md) · [Widget Spec](07-spec-wallet-widget.md) · [Scaffolder Spec](08-spec-scaffolder.md) · [MCP Spec](09-spec-mcp.md)
