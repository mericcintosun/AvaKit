# 01 — Product Requirements Document (PRD)

**Ürün:** AvaKit
**Durum:** Taslak v1 (planlama)
**Son güncelleme:** 2026-07-01
**Sahip:** —

---

## 1. Problem tanımı

Avalanche C-Chain EVM uyumlu ve son-kullanıcı onboarding'i (seedless/social login) Core ve Cubist tarafından çözülmüş olmasına rağmen, **yeni veya AI-destekli bir geliştiricinin Avalanche üstünde modern, onboarding'i hazır bir dapp'e başlaması hâlâ zor.**

Bugün bir geliştirici şunları elle birleştirmek zorunda:
- RPC URL'leri, chain ID'leri, faucet (Fuji testnet)
- Embedded/social-login wallet entegrasyonu (provider seçimi, key yönetimi, env config)
- Frontend iskeleti (Next.js + wagmi + viem + UI)
- Smart contract tooling (Foundry/Hardhat) + deploy script'leri
- Bunların birbiriyle uyumlu çalışması

Sonuç: "Avalanche'i deneyeyim" ile "çalışan ilk transaction" arasındaki mesafe saatler/günler. AI araçlarıyla (Claude Code, Cursor) çalışan "vibe coder"lar için ise chain-spesifik bağlam eksikliği yüzünden daha da zor.

## 2. Hedefler & hedef olmayanlar

### Hedefler
- G1: Sıfırdan çalışan, social-login'li, deploy edilebilir bir Avalanche dapp'ini **< 5 dakikada** ayağa kaldırmak.
- G2: EVM dev'in **mevcut** dapp'ine social-login wallet'ı **tek component** ile eklemesini sağlamak.
- G3: AI kod araçlarının (Claude/Cursor) Avalanche'de scaffold + deploy yapabilmesi için **MCP** + **agent context** sağlamak.
- G4: Tamamen **açık kaynak (MIT)** ve **ücretsiz default** ile vendor lock-in'siz bir alternatif olmak.

### Hedef olmayanlar (anti-goals)
- A1: Kendi key management / cüzdan altyapısını yazmak. (Web3Auth/AvaCloud sarılır.)
- A2: Yeni bir UI component kütüphanesi yaratmak. (shadcn/ui benimsenir; bileşenler onun üstüne kurulur.)
- A3: Subnet/L1 launch tooling'i yeniden yazmak. (Avalanche CLI / `avalanche-cli` zaten var; MCP onu çağırabilir ama biz yeniden yazmayız.)
- A4: Custodial / backend wallet servisi sunmak.

## 3. Persona'lar

### P1 — "Vibe coder" Vera
- Web2/JS background, blockchain'e yabancı. Cursor + Claude ile geliştiriyor.
- İhtiyaç: "Çalışsın yeter." Seed phrase, RPC, faucet gibi kavramlarla uğraşmak istemiyor.
- AvaKit kapısı: `create-avalanche-app` + MCP. Doğal dilde "Avalanche dapp kur, social login olsun" der.

### P2 — "EVM dev" Emir
- Ethereum/Solidity tecrübeli. Foundry, viem, wagmi biliyor. Avalanche'a yeni geçiyor.
- İhtiyaç: Tanıdık stack, vendor lock-in yok, mevcut projeye drop-in entegrasyon.
- AvaKit kapısı: `@avakit/react` widget + `@avakit/core` SDK.

### P3 — "Ekosistem savunucusu" (ikincil)
- Avalanche DevRel / TR topluluk lideri. Workshop, hackathon, demo için hızlı başlangıç arıyor.
- İhtiyaç: Tek repo ile insanları 5 dakikada çalışan dapp'e ulaştırmak.
- AvaKit kapısı: Template galerisi + dökümante onboarding.

## 4. Kullanıcı yolculukları (user journeys)

### J1 — Vibe coder, sıfırdan (MCP)
1. Claude Code'da: "Avalanche'de bir token-gated chat dapp'i kur, Google login'li."
2. MCP `scaffold_app` tool'unu çağırır → proje oluşur.
3. MCP `dev` ve `deploy_contract` ile Fuji'ye deploy eder.
4. Tarayıcıda Google ile giriş → ilk tx. **< 5 dk.**

### J2 — Vibe coder, sıfırdan (CLI)
1. `npm create avalanche-app@latest`
2. İnteraktif sorular: template, wallet provider (default Web3Auth), chain (default Fuji).
3. `cd app && pnpm dev` → çalışan social-login'li dapp.

### J3 — EVM dev, mevcut projeye ekleme
1. `pnpm add @avakit/react @avakit/core`
2. `<AvaKitProvider>` ile sarıp `<ConnectAvalanche />` yerleştir.
3. `.env`'e provider client ID. Bitti.

## 5. Fonksiyonel gereksinimler

| ID | Gereksinim | Öncelik | Milestone |
|---|---|---|---|
| FR-1 | `@avakit/core`: chain config (Fuji/C-Chain/custom L1), viem client, deploy helper | P0 | M1 |
| FR-2 | `@avakit/core`: wallet adapter arayüzü; Web3Auth default impl | P0 | M1 |
| FR-3 | `@avakit/react`: `<AvaKitProvider>` + `<ConnectAvalanche>` social-login widget | P0 | M1 |
| FR-4 | `@avakit/react`: shadcn/ui üstüne kurulu AvaKit bileşenleri (chain selector, hesap kartı) + hooks | P1 | M1 |
| FR-5 | `create-avalanche-app`: interaktif scaffolder, ≥2 template | P0 | M2 |
| FR-6 | Template: Next.js + social login + örnek contract + Fuji deploy script | P0 | M2 |
| FR-7 | Her template'te `CLAUDE.md` + `llms.txt` + cursor rules | P0 | M2 |
| FR-8 | `@avakit/mcp`: `scaffold_app`, `deploy_contract`, `read_chain`, `get_context` tool'ları | P0 | M3 |
| FR-9 | AvaCloud WaaS opsiyonel wallet adapter | P2 | M3+ |
| FR-10 | Custom L1 desteği (kendi chain ID/RPC ekleme) | P1 | M2 |

## 6. Fonksiyonel olmayan gereksinimler

- NFR-1 (DX): `create-avalanche-app`'ten çalışan dev sunucusuna **< 5 dk**, sıfır manuel config.
- NFR-2 (Açıklık): MIT lisans; tüm paketler npm'de public.
- NFR-3 (Taşınabilirlik): Wallet provider değiştirilebilir; lock-in yok.
- NFR-4 (Güvenlik): Private key hiçbir zaman AvaKit kodundan geçmez; provider HSM/enclave kullanır. Hiçbir secret repoya/log'a yazılmaz.
- NFR-5 (Type-safety): Uçtan uca TypeScript; contract ABI'leri için tip üretimi.
- NFR-6 (AI-ergonomi): MCP tool'ları idempotent, açıklayıcı hatalar döner; agent context dosyaları güncel.

## 7. Başarı metrikleri

| Metrik | Hedef (ilk 6 ay) |
|---|---|
| Time-to-first-tx (sıfırdan) | < 5 dk |
| `create-avalanche-app` haftalık npm indirme | büyüyen trend |
| GitHub star | topluluk ilgisinin sinyali |
| MCP kurulumu (Claude/Cursor) | DevRel demolarında varsayılan araç |
| "Çalışmadı" kaynaklı issue oranı | düşük; çoğu config değil kullanım |

## 8. Riskler & azaltımlar

| Risk | Etki | Azaltım |
|---|---|---|
| AvaCloud WaaS bizi geçersiz kılar | Yüksek | Açık kaynak + ücretsiz + multi-provider; WaaS'ı *destekle*, rakip olma |
| Web3Auth/MetaMask API kırılması | Orta | Adapter pattern; provider'ı arkasında soyutla |
| Web3Auth/SDK/shadcn breaking change | Orta | Pin sürümler, adapter/sarmalama katmanı |
| Kapsam şişmesi (3 ürün aynı anda) | Yüksek | Dikey dilim: M1 çekirdek+widget önce, sonra genişlet |
| Ava Labs benzerini resmi yapar | Orta | Önce hareket et + AI-native açıyı sahiplen; gerekirse upstream'e katkı |

## 9. Açık sorular

- Default template seti ne olmalı? (öneri: `minimal`, `token-gated-app`, `nft-mint`)
- Mainnet deploy'u v1 kapsamına mı, yoksa testnet-first mi? (öneri: testnet-first, mainnet M3)
- MCP, `avalanche-cli`'yi mi sarsın yoksa kendi deploy path'ini mi kullansın? (bkz. [ADR](04-adr.md))

İlgili: [Vizyon](00-vision-and-positioning.md) · [Rakip Analizi](02-competitive-landscape.md) · [Roadmap](05-roadmap.md)
