# 05 — Yol Haritası

## Felsefe: dikey dilim, geniş-ama-sığ değil

Üç yüzeyi aynı anda yapmak tuzaktır. Her milestone **kendi başına kullanılabilir** bir şey teslim eder; yarıda kalsa bile elde değer kalır. Sıra: **çekirdek → scaffolder → AI yüzeyi.**

```
M1  @avakit/core + @avakit/react        →  "çalışan social-login + ilk tx" kanıtı
M2  create-avalanche-app + template'ler →  "tek komutla dapp" (vibe coder hook'u)
M3  @avakit/mcp + AI context            →  "Claude/Cursor'dan scaffold+deploy" (AI-native)
```

---

## M0 — Repo kurulumu (TAMAMLANDI ✅)
**Amaç:** çalışılabilir monorepo iskeleti. (Kod değil, altyapı.)

Teslimatlar:
- [x] pnpm workspaces + Turborepo + Changesets monorepo (pnpm catalog ile merkezi sürümler)
- [x] TypeScript base config + **Biome** (lint/format tek araç)
- [x] Paket stub'ları: `@avakit/core` (chain registry + WalletAdapter), `@avakit/react`, `@avakit/mcp` (çalışan stdio skeleton), `create-avalanche-app`
- [x] MIT lisans (nötr), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY
- [x] Bağımlılık lisans denetimi (tümü permissive; sharp/libvips LGPL native binary — Next transitive, sorun değil)
- [x] UI baseline: shadcn/ui + Tailwind v4 + next-themes (dark/light), **siyah/beyaz token seti** — latest stable (Next 16, React 19, TS 6)
- [x] CI (`.github/workflows/ci.yml`): lint + typecheck + build + test (pnpm + Node 24). Repo push'landığında çalışır.

Çıkış kriteri: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck` geçiyor; `apps/web` çalışıyor. ✅

> Not: M0 "boş paket" yerine, çekirdeğin chain registry'si gibi gerçek-ama-minimal içerikle geldi (kapsamlı kurulum tercih edildi).

---

## M1 — Çekirdek + Widget (TAMAMLANDI ✅ — canlı social-login testi hariç)
**Amaç:** Fuji'de cüzdan bağla, bakiye gör, bir tx gönder — **bir örnek app içinde.**

`@avakit/core`:
- [x] Chain registry: Fuji, C-Chain, custom L1 ekleme (M0'dan)
- [x] viem client factory (public + wallet)
- [x] `WalletAdapter` arayüzü + `InjectedAdapter` (tam, test edildi) + `Web3AuthAdapter` (`@avakit/core/web3auth` subpath; yazıldı/tiplendi, **canlı testi client ID ile ertelendi** — ADR-011)
- [x] Deploy helper (artefact → deploy → adres) + `getBytecode`
- [x] Data: bakiye / tx receipt / contract read

`@avakit/react` (viem + context — ADR-011; UI shadcn-style — ADR-012):
- [x] `<AvaKitProvider>` (chains + adapters + bağlantı durumu)
- [x] `<ConnectAvalanche>` (Radix Dialog, adapter seçici)
- [x] Hooks: `useAvaAccount`, `useAvaChain`, `useBalance`, `useContract`, `useAvaDeploy`
- [x] shadcn-style bileşenler (Button/Dialog); dark/light + siyah/beyaz

`examples/`:
- [x] `examples/hello-avax`: injected (Core/MetaMask) bağlan + bakiye + Fuji'de 0-AVAX tx (canlı demo; build + prerender doğrulandı)

**Çıkış kriteri:** `@avakit/react` + `<ConnectAvalanche>` ile bir Next app'te bağlan→bakiye→ilk tx çalışıyor (injected yol doğrulandı). Social-login yolu (Web3Auth) ücretsiz client ID + tarayıcı ile doğrulanmayı bekliyor.

> **Kapsam notu:** wagmi yerine viem+context seçildi (ADR-011); Web3Auth canlı akışı sürüm-oynak ve client ID gerektirdiği için izole/işaretli bırakıldı. Injected (Core — Avalanche'in native cüzdanı) M1'in doğrulanmış "wow"u.

---

## M2 — Scaffolder + Template'ler (TAMAMLANDI ✅)
**Amaç:** Tek komutla, M1 çekirdeğini kullanan, deploy edilebilir tam dapp.

`create-avalanche-app`:
- [x] İnteraktif CLI (@clack/prompts: template, wallet, chain, paket yöneticisi)
- [x] Template render + dependency install + `.env.example` + dotfile rename (`gitignore`→`.gitignore` vb.)
- [x] AI context enjeksiyonu: `CLAUDE.md`, `llms.txt`, `.cursor/rules/avakit.mdc`
- [x] `--yes` non-interactive mod (MCP/CI için) + `--no-install` + `--local` (workspace link)

Template'ler:
- [x] `minimal` — social login + bağlan + bakiye + tx (shadcn + siyah/beyaz + dark/light)
- [x] `nft-mint` — tarayıcıdan deploy + mint; **self-contained ERC-721** (`contracts/src/AvaKitNFT.sol`) forge ile derlenip bytecode `lib/nft-artifact.ts`'e gömüldü → Foundry kurmadan tarayıcıdan deploy
- [x] `token-gated-app` — access-pass NFT sahipliğine göre içerik kilidi (`balanceOf > 0` → açık); aynı ERC-721'i yeniden kullanır + güvenlik notu (client-side gating illustratif)

**Doğrulama:** Her iki template de `--local` ile workspace'e üretilip **gerçekten build edildi** (Next compile + TS + prerender). Scaffolder çıktısı: doğru yapı, placeholder yok, dotfile rename'leri ✓, `manifest.json` sızmıyor ✓, AI context ✓. NFT contract forge ile derlendi.

**Çıkış kriteri:** ✅ `create-avalanche-app` → build edilen, social-login'li, AI-context'li dapp; `nft-mint`'te tarayıcıdan deploy edilebilir contract. (Gerçek on-chain deploy/mint gas gerektirir — kod yolu doğrulandı.)

> Not: AvaKit paketleri henüz npm'de değil; üretilen app gerçek kullanımda `@avakit/*@^0.1.0`'a bağlanır (publish sonrası). `--local` repo-içi test/geliştirme içindir.

---

## M3 — MCP + AI-native katman (TAMAMLANDI ✅)
**Amaç:** Claude Code / Cursor'dan doğal dille scaffold + deploy.

`@avakit/mcp` (stdio, `@modelcontextprotocol/sdk` 1.29 + zod 4):
- [x] MCP server (stdio) — `initialize`/`tools/list`/`tools/call` doğrulandı
- [x] Tool: `scaffold_app` (create-avalanche-app'i programatik `scaffoldApp` API'siyle sarar)
- [x] Tool: `list_templates`
- [x] Tool: `read_chain` (balance / txReceipt / contractRead) — **canlı Fuji RPC ile test edildi**
- [x] Tool: `deploy_contract` (viem + `AVAKIT_DEPLOYER_KEY`; testnet-default, **mainnet confirm:true zorunlu** — guardrail test edildi)
- [x] Tool: `get_context` (AvaKit API + konvansiyon + doc linkleri)
- [x] Kurulum: `{ "mcpServers": { "avakit": { "command": "npx", "args": ["-y", "@avakit/mcp"] } } }`

AI context (ürün geneli):
- [x] Her template `CLAUDE.md` + `llms.txt` + `.cursor/rules` ile geliyor (M2)
- [x] `get_context` tool'u AvaKit bağlamını + resmi `llms.txt` linkini veriyor

**Doğrulama:** MCP sunucusu spawn edilip JSON-RPC ile konuşuldu: 5 tool listelendi, `list_templates`/`scaffold_app` (15 dosya) çalıştı, `read_chain` **canlıda Fuji bakiyesi okudu**, `deploy_contract` mainnet'i confirm olmadan reddetti. create-avalanche-app programatik API (`/api`) olarak dışa açıldı.

**Çıkış kriteri:** ✅ Claude/Cursor MCP client'ından `scaffold_app` → (fonlu key ile) `deploy_contract` zinciri kurulabiliyor.

---

## M4+ — Sonrası (backlog)
- [x] **npm publish hazırlığı** — sürümler 0.1.0, metadata/README/LICENSE, dry-run doğrulandı (bkz. RELEASING.md)
- [x] **Ürün sitesi (`apps/web`)** — landing (hero/surfaces/features/steps/templates/mcp/faq) + `/docs` (5 sayfa + sidebar) + `/templates`; shadcn-only, siyah/beyaz, dark/light, Framer Motion; 8 route prerender
- [x] **`erc20-token` template'i** — self-contained ERC-20, tarayıcıdan deploy + mint + transfer (toplam 4 template)
- [ ] AvaCloud WaaS adapter (opt-in)
- [ ] Mainnet deploy akışı + güvenlik onay kapıları (UI)
- [ ] Ek template'ler (DeFi swap, DAO, payment)
- [ ] Privy/Dynamic/Turnkey adapter'ları
- [ ] Subnet/L1 launch tool'u (avalanche-cli compose, opsiyonel)
- [ ] Vite/React Native template variant'ları
- [ ] Gerçek npm publish (hesap tarafı: npm login + @avakit org)

---

## Milestone bağımlılıkları

```
M0 ──> M1 ──> M2 ──> M3
              │
              └─> (M2 olmadan M3'ün scaffold_app'i olmaz)
M1 widget, M3'ün ürettiği app'lerin içinde de kullanılır.
```

## Ölçüm (her milestone sonunda)
- M1: time-to-first-tx (hedef < 5 dk)
- M2: time-to-running-dapp (hedef < 5 dk, sıfır config)
- M3: AI ile uçtan uca scaffold+deploy başarı oranı

İlgili: [PRD](01-prd.md) · [Mimari](03-architecture.md)
