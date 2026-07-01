# 08 — Spec: `create-avalanche-app`

**Rol:** Batteries-included scaffolder. Vibe coder'ın tek komutu. `@avakit/core` + `@avakit/react` kullanan, deploy edilebilir, AI context'i gömülü bir dapp üretir.
**Milestone:** M2.

## Çağırma

```bash
npm create avalanche-app@latest          # interaktif
# veya
pnpm create avalanche-app my-app --template token-gated-app --wallet web3auth --chain fuji --yes
```

## İnteraktif akış

```
◆  Proje adı? ……………………… my-avax-app
◆  Template?
   › minimal              (social login + bağlan + tx)
     token-gated-app      (NFT/ERC-20 sahipliğine göre içerik)
     nft-mint             (mint akışı + contract + deploy)
◆  Wallet provider?
   › web3auth   (ücretsiz, social login — önerilen)
     injected   (Core / MetaMask)
     avacloud   (WaaS — client gerektirir)
◆  Hedef chain?
   › fuji       (testnet — önerilen)
     c-chain    (mainnet)
     custom L1  (chainId + RPC sorulur)
◆  Paket yöneticisi? … pnpm / npm / yarn / bun
◆  Şimdi kurulsun mu (install)? … evet
```

`--yes` modunda tüm sorular flag/default'tan gelir (CI ve MCP `scaffold_app` için gerekli).

## Üretilen proje yapısı (örnek: `token-gated-app`)

```
my-avax-app/
├── app/                      # Next.js App Router
│   ├── providers.tsx         # <AvaKitProvider> + ThemeProvider (next-themes)
│   ├── page.tsx              # <ConnectAvalanche> + token-gate örneği
│   └── layout.tsx
├── components/ui/            # shadcn/ui bileşenleri (tek UI lib)
├── contracts/                # Foundry
│   ├── src/Token.sol
│   ├── script/Deploy.s.sol
│   └── foundry.toml
├── lib/avakit.ts             # chain + adapter config
├── .env.example              # WEB3AUTH_CLIENT_ID, RPC, vs.
├── CLAUDE.md                 # AI agent context (bkz. doc 10)
├── llms.txt                  # AI-friendly proje haritası
├── .cursor/rules/avakit.mdc  # Cursor kuralları
├── package.json              # script'ler: dev, build, deploy:fuji
└── README.md                 # 3 adımlık başlangıç
```

## `package.json` script'leri (üretilen)
- `dev` — Next.js dev sunucusu.
- `deploy:fuji` — Foundry ile contract'ı Fuji'ye deploy + adresi `.env.local`'e yazar.
- `deploy:mainnet` — C-Chain; **onay istemi** + bakiye kontrolü (ADR-007).
- `typegen` — ABI'den tip üretimi.

## Çıktı sonrası kullanıcı deneyimi
```
✓ my-avax-app hazır.

Sonraki adımlar:
  cd my-avax-app
  cp .env.example .env.local   # WEB3AUTH_CLIENT_ID ekle (ücretsiz: dashboard linki)
  pnpm deploy:fuji             # örnek contract'ı testnet'e at
  pnpm dev                     # http://localhost:3000

İpucu: Cursor/Claude kullanıyorsan CLAUDE.md ve .cursor/rules zaten hazır.
```

## AI context enjeksiyonu (farklılaşmanın kalbi)
Her üretilen projeye otomatik eklenir (bkz. [doc 10](10-ai-native-strategy.md)):
- `CLAUDE.md` — proje mimarisi, AvaKit API'leri, yaygın görevler, "şunu yapma" kuralları.
- `llms.txt` — dosya haritası + önemli giriş noktaları.
- `.cursor/rules/avakit.mdc` — Cursor için aynı bağlam.

## Template manifest
Her template `templates/<name>/manifest.json` ile gelir:
```json
{
  "name": "token-gated-app",
  "description": "NFT/ERC-20 sahipliğine göre içerik kilidi",
  "supports": { "wallet": ["web3auth", "injected", "avacloud"], "chains": ["fuji", "c-chain", "custom"] },
  "contracts": true,
  "postInstall": ["typegen"]
}
```
CLI ve MCP bu manifest'i okuyarak seçenekleri dinamik üretir (yeni template eklemek = klasör + manifest).

## UI & tema (proje kuralı — [doc 11](11-conventions.md))
- Her template **shadcn/ui** + **Tailwind v4** + **next-themes** ile gelir; dark/light toggle hazır.
- M3 bitene kadar **sadece siyah/beyaz** token'lar; renk en sona. Animasyon Framer Motion.
- Latest stable sürümler (Next.js 16, React 19 vb.).

## Teknik notlar
- Template'ler placeholder'lı gerçek dosyalar (ör. `__PROJECT_NAME__`), render sırasında doldurulur.
- Wallet/chain seçimi `lib/avakit.ts` ve `.env.example`'ı şekillendirir.
- Hardhat variant'ı (ADR-004) ayrı template veya `--contracts hardhat` flag'i.

## Kabul kriteri (M2)
`npm create avalanche-app` → `pnpm deploy:fuji` → `pnpm dev` ile **sıfır manuel kod**, çalışan social-login'li dapp; örnek contract Fuji'de, frontend'den okunuyor.

İlgili: [Widget Spec](07-spec-wallet-widget.md) · [MCP Spec](09-spec-mcp.md) · [AI-Native](10-ai-native-strategy.md)
