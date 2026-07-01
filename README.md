# AvaKit

> **Avalanche'in açık kaynak, AI-native `create-next-app`'i.**
> Tek komutla social-login onboarding'li, deploy'a hazır, içinde agent context'i gelen Avalanche dapp'i.

AvaKit; Avalanche ekosisteminin "vibe coder friendly" hâle gelmesi için tasarlanmış, tek çekirdek üstünde üç yüzeyden oluşan açık kaynaklı bir geliştirici araç setidir:

1. **`@avakit/core`** — EVM + seedless/social-login wallet + chain data + deploy yardımcıları (kernel)
2. **`@avakit/react`** — `<ConnectAvalanche>` drop-in widget'ı (EVM dev'in mevcut dapp'ine gömdüğü)
3. **`create-avalanche-app`** — batteries-included scaffolder (vibe coder'ın tek komutu)
4. **`@avakit/mcp`** — Claude/Cursor'ın scaffold + deploy için sürdüğü MCP server'ı

Tasarım ilkesi: **yeniden yazma, sar.** AvaKit olgun *altyapı* parçalarını (Web3Auth/AvaCloud WaaS wallet, Avalanche SDK, viem/wagmi) sarar; değeri key management'ta değil, **paketleme + vibe-coder/AI ergonomisinde**dir. (UI tarafında ise istisna: bileşenler **shadcn/ui** üstüne sıfırdan kurulur — bkz. [Conventions](docs/11-conventions.md).)

---

## Bu repo şu an ne durumda?

**M0–M3 tamamlandı** ✅ — tüm dört paket + web + örnek build oluyor, testler/typecheck/lint yeşil.
- **M0:** monorepo + shadcn/Tailwind v4/next-themes siyah-beyaz, dark/light baseline
- **M1:** `@avakit/core` (adapters, deploy, data, chain switch) + `@avakit/react` (`<ConnectAvalanche>`, hooks); social login **canlıda doğrulandı**
- **M2:** `create-avalanche-app` scaffolder + 3 template (minimal, nft-mint, token-gated-app), her biri AI-context'li; hepsi build-doğrulandı
- **M3:** `@avakit/mcp` — scaffold_app / deploy_contract / read_chain / get_context / list_templates; MCP fonksiyonel testi + canlı Fuji okuma geçti

Detay: [Roadmap](docs/05-roadmap.md).

### Geliştirme komutları

```bash
pnpm install
pnpm build       # tüm paketler + web (Turborepo)
pnpm test        # Vitest
pnpm lint        # Biome (lint + format)
pnpm typecheck   # TypeScript
pnpm --filter @avakit/web dev   # web frontend
```

Gereksinim: Node ≥ 20.11 (repo Node 24 hedefler), pnpm ≥ 10 (`corepack enable`).

## Dokümanlar

| # | Doküman | İçerik |
|---|---|---|
| 00 | [Vizyon & Konumlandırma](docs/00-vision-and-positioning.md) | Neden var, kime, tek cümlelik konum |
| 01 | [PRD](docs/01-prd.md) | Problem, persona'lar, hedefler, kapsam, gereksinimler, başarı metrikleri |
| 02 | [Rakip Analizi](docs/02-competitive-landscape.md) | Prior art haritası, whitespace, çakışma riskleri |
| 03 | [Mimari](docs/03-architecture.md) | Monorepo, paketler, veri akışı, çekirdek-yüzey ilişkisi |
| 04 | [Mimari Kararlar (ADR)](docs/04-adr.md) | Wallet sağlayıcı, monorepo aracı, stack seçimleri + gerekçeleri |
| 05 | [Yol Haritası](docs/05-roadmap.md) | M1 → M2 → M3 milestone'ları ve teslimatları |
| 06 | [Spec: Core SDK](docs/06-spec-core-sdk.md) | `@avakit/core` API yüzeyi |
| 07 | [Spec: Wallet Widget](docs/07-spec-wallet-widget.md) | `@avakit/react` / `<ConnectAvalanche>` |
| 08 | [Spec: Scaffolder](docs/08-spec-scaffolder.md) | `create-avalanche-app` akışı ve template'ler |
| 09 | [Spec: MCP Server](docs/09-spec-mcp.md) | `@avakit/mcp` tool yüzeyi |
| 10 | [AI-Native Strateji](docs/10-ai-native-strategy.md) | CLAUDE.md / llms.txt / cursor rules yaklaşımı |
| 11 | [Conventions (bağlayıcı kurallar)](docs/11-conventions.md) | Dil, shadcn-only, animasyon, siyah/beyaz + tema, sürümler |

## Hızlı özet (TL;DR)

- **Hedef kitle:** (1) blockchain bilmeyen "vibe coder" (Cursor/Claude ile kod yazan), (2) Ethereum'dan gelen EVM/Solidity dev. İkisi de aynı ürünün farklı kapısından girer.
- **Çözülen gerçek problem:** Onboarding sürtünmesi *son kullanıcı* için Core/Cubist ile zaten çözülmüş. Asıl boşluk **dev tarafında** — yeni/AI-destekli bir geliştiricinin social-login'li, deploy edilebilir bir Avalanche dapp'ini dakikalar içinde ayağa kaldıramaması.
- **Farklılaşma:** Açık kaynak + ücretsiz (AvaCloud WaaS ücretli/kapalı) + AI-native by default (mevcut MCP'ler sadece docs/CLI yapıyor) + üç yüzeyi tek çekirdekte birleştirme.
- **Lisans:** MIT.

## Teknoloji kararları (özet)

| Karar | Seçim | Detay |
|---|---|---|
| Default embedded wallet | Web3Auth (MetaMask Embedded Wallets) | Ücretsiz, açık, C-Chain'de social login. AvaCloud WaaS opsiyonel. |
| Monorepo | pnpm workspaces + Turborepo | — |
| Frontend stack | Next.js 16 + React 19 + wagmi + viem + Tailwind v4 | latest stable |
| UI kütüphanesi | **shadcn/ui (tek)** | başka lib yok, BuilderKit UI dahil değil |
| Animasyon | Framer Motion / GSAP | — |
| Tema & renk | next-themes (dark/light baştan), **M3'e kadar siyah/beyaz** | renk en sona |
| Smart contract | Foundry (birincil), Hardhat (opsiyonel) | Resmi starter-kit ile hizalı |
| MCP | `@modelcontextprotocol/sdk` (TypeScript, stdio) | — |
| Diller | TypeScript + Solidity | proje artefaktları İngilizce |

Detaylar ve gerekçeler: [ADR](docs/04-adr.md) · Bağlayıcı kurallar: [Conventions](docs/11-conventions.md).
