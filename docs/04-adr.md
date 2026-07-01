# 04 — Mimari Karar Kayıtları (ADR)

Her karar: **bağlam → karar → gerekçe → sonuçlar → alternatifler.** Durum: `Kabul` (planlama fazında onaylı) / `Öneri` (tartışmaya açık).

---

## ADR-001 — Default embedded wallet sağlayıcı: Web3Auth (MetaMask Embedded Wallets)
**Durum:** Kabul

**Bağlam.** Social-login onboarding ürünün kalbi. Kendi key management'ımızı yazmak güvenlik riski ve Ava Labs WaaS ile rekabet demek. Adaylar: Web3Auth (ücretsiz tier, açık SDK, C-Chain destekli), AvaCloud WaaS (ücretli/kapalı, Cubist HSM), Privy/Dynamic/Turnkey (genel).

**Karar.** Default sağlayıcı **Web3Auth**. `WalletAdapter` arayüzü ardında soyutlanır; **AvaCloud WaaS** ve **Injected (Core/MetaMask)** adapter'ları opsiyonel.

**Gerekçe.**
- Ücretsiz tier → vibe coder sıfır maliyetle başlar (anti-lock-in, açık kaynak ruhu).
- Avalanche C-Chain'de resmi olarak destekli.
- Adapter pattern sayesinde sağlayıcı değiştirmek tek satır.

**Sonuçlar.** Web3Auth client ID gerektirir (ücretsiz alınır); template `.env.example` bunu belgelemeli. Web3Auth API kırılırsa adapter izole eder.

**Alternatifler & neden değil.** AvaCloud WaaS default olursa ücret + lock-in + kapalı kaynak → konumlandırmaya aykırı (yine de opt-in adapter olarak değerli). Kendi cüzdanı → güvenlik riski (reddedildi).

---

## ADR-002 — Monorepo aracı: pnpm workspaces + Turborepo
**Durum:** Kabul

**Bağlam.** 4 paket + template'ler + örnekler tek repoda. Paylaşılan tipler, atomic değişiklik gerekiyor.

**Karar.** **pnpm workspaces** (paket yönetimi) + **Turborepo** (task orchestration/cache) + **Changesets** (sürümleme).

**Gerekçe.** pnpm hızlı + disk-verimli + sıkı dependency izolasyonu. Turbo cache CI'yı hızlandırır. Ekosistemde standart, vibe coder/EVM dev tanıdık bulur.

**Sonuçlar.** `pnpm` zorunlu (CI'da enforce). Alternatif: Nx (daha ağır), Lerna (bakım azalan) — reddedildi.

---

## ADR-003 — Frontend stack: Next.js 16 + React 19 + wagmi + viem + Tailwind v4 + shadcn/ui
**Durum:** Kabul (proje kuralları ile güncellendi — bkz. [doc 11](11-conventions.md))

**Bağlam.** Template'ler ve widget için modern, EVM dev'e tanıdık, AI araçlarının iyi bildiği bir stack lazım. Proje sahibi UI kütüphanesini **yalnızca shadcn/ui** olarak sabitledi.

**Karar.** **Next.js (App Router, latest stable — şu an 16)** + **React 19** + **wagmi** (React hooks) + **viem** (düşük seviye) + **Tailwind v4** + **shadcn/ui** (tek UI kütüphanesi). Animasyon: **Framer Motion / GSAP**. Tema: **next-themes** ile dark/light en baştan; M3 bitene kadar **sadece siyah/beyaz**.

**Gerekçe.** viem/wagmi EVM standardı; Claude/Cursor bu API'leri iyi biliyor (AI-ergonomi). Next.js en yaygın React meta-framework. shadcn/ui Tailwind + Radix üstüne kurulu, a11y bedava, AI araçları iyi biliyor, kopyala-sahiplen modeli vendor lock-in'siz.

**Sonuçlar.**
- Çekirdek (`@avakit/core`) yine de framework-agnostic kalır (sadece viem'e bağlı); React'e özgü her şey `@avakit/react`'te.
- **BuilderKit UI olarak KULLANILMAZ** (önceki "BuilderKit sarılır" kararı iptal). Avalanche-spesifik bileşenler shadcn primitive'leri üstüne sıfırdan kurulur. Bu, Ava Labs ile çakışma yaratabilir ama proje kuralı (shadcn-only) bağlayıcı; ayrıca kendi tasarım dilimizi (siyah/beyaz, tema-öncelikli) tam kontrol etmemizi sağlar.

**Alternatifler.** ethers.js (viem lehine bırakıldı), Vite SPA (Next.js daha yaygın; ileride Vite template eklenebilir), BuilderKit UI (shadcn-only kuralı nedeniyle reddedildi).

---

## ADR-004 — Smart contract tooling: Foundry birincil, Hardhat opsiyonel
**Durum:** Kabul

**Bağlam.** Resmi `avalanche-starter-kit` Foundry kullanıyor; tutarlılık ve hız önemli.

**Karar.** **Foundry (forge/cast)** birincil derleme/deploy yolu; **Hardhat** opsiyonel template variant.

**Gerekçe.** Resmi starter-kit ile hizalı, hızlı, yaygın. Hardhat'ı isteyen JS-ağırlıklı ekipler için variant bırakılır.

**Sonuçlar.** `@avakit/core` deploy helper'ı Foundry artefact formatını (`out/*.json`) okur. Hardhat variant ayrı artefact path'i ele alır.

---

## ADR-005 — MCP deploy yolu: `@avakit/core`'u sar, `avalanche-cli`'yi yeniden yazma
**Durum:** Öneri

**Bağlam.** MCP `deploy_contract` tool'u nasıl deploy etsin? İki yol: (a) kendi core deploy helper'ımız, (b) `avalanche-cli`'yi shell'den çağır.

**Karar (öneri).** Contract/dapp deploy için **`@avakit/core` deploy helper'ını** kullan. Subnet/L1 *launch* gerekirse `avalanche-cli`'yi sarmak makul (orada `utkucy/avalanche-mcp-tools` zaten var; tekrar yapmayız, gerekirse compose ederiz).

**Gerekçe.** Tek deploy path → tutarlı davranış (CLI ve MCP aynı core'u kullanır). L1 launch nadir ve ayrı bir domain.

**Sonuçlar.** v1 MCP kapsamı dapp/contract'a odaklanır; L1 launch backlog'a.

---

## ADR-006 — Lisans: MIT
**Durum:** Kabul

**Bağlam.** Açık kaynak + ücretsiz, AvaCloud WaaS'a karşı temel ayrışma.

**Karar.** Tüm paketler **MIT**.

**Gerekçe.** İzin verici lisans benimsemeyi maksimize eder; vibe coder ve şirketler çekinmeden kullanır. Konumlandırmanın ("açık alternatif") yasal omurgası.

**Sonuçlar.** Sarılan bağımlılıkların (Web3Auth, BuilderKit, viem) lisansları MIT-uyumlu olmalı; M1 öncesi doğrulanmalı.

---

## ADR-007 — Chain varsayılanı: testnet-first (Fuji), mainnet opt-in
**Durum:** Kabul

**Bağlam.** Yeni dev'i mainnet'te gerçek parayla riske atmamak gerekir.

**Karar.** Default chain **Fuji testnet**; faucet linki ve test AVAX akışı dökümante. Mainnet (C-Chain) açık opt-in + deploy öncesi onay.

**Gerekçe.** Güvenli default = düşük sürtünme + düşük risk. Time-to-first-tx testnet'te ölçülür.

**Sonuçlar.** Template'ler Fuji'ye deploy ile gelir; mainnet için ek doğrulama adımı (bkz. Scaffolder/MCP spec).

---

## ADR-008 — Dil: TypeScript + Solidity, uçtan uca tip güvenliği
**Durum:** Kabul

**Bağlam.** AI araçları ve EVM dev'ler için tip güvenliği DX'in büyük kısmı.

**Karar.** Tüm JS/TS paketleri **TypeScript**; contract ABI'lerinden tip üretimi (ör. wagmi cli / abitype).

**Gerekçe.** Hatalar compile-time'da yakalanır; AI üretimi kod tiplerle "doğrulanır"; otomatik tamamlama güçlü.

**Sonuçlar.** Build pipeline'da codegen adımı; ABI değişince tipler yenilenir.

---

## ADR-009 — Tasarım kısıtları: shadcn-only UI, Framer/GSAP, siyah-beyaz + tema-öncelikli
**Durum:** Kabul (proje sahibi kuralı)

**Bağlam.** Tutarlı, sade, sonradan kolay renklendirilebilir bir tasarım dili isteniyor.

**Karar.**
- UI yalnızca **shadcn/ui** (başka component lib yok, BuilderKit UI dahil değil).
- Animasyon yalnızca **Framer Motion** veya **GSAP**.
- M1–M3 (ürün) bitene kadar **sadece siyah/beyaz**; **dark/light tema en baştan** (`next-themes`); renk **en sona**.
- Hedef: **2026-modern, profesyonel devtools** estetiği (Linear/Vercel/shadcn-dashboard cilası, şimdilik renksiz).

**Gerekçe.** Tek UI dili = tutarlılık + düşük bakım + güçlü AI-ergonomi (ajan tek pattern üretir). Tema token'ları üstüne sonradan renk eklemek refactor değil token değişimi olur.

**Sonuçlar.** Tüm bileşenler her iki temada test edilir. Renk token'ları baştan tema değişkenleri olarak tanımlanır. Detay: [doc 11](11-conventions.md).

---

## ADR-010 — Sürüm politikası: her frontend teknolojisinin en son stabil sürümü
**Durum:** Kabul (proje sahibi kuralı)

**Bağlam.** Modern görünüm ve uzun ömür için güncel stack gerekiyor.

**Karar.** Her frontend teknolojisi **latest stable** (ör. Next.js 16, React 19, Tailwind v4, son shadcn/ui, son next-themes). Sürümler lockfile'da pin'lenir.

**Gerekçe.** 2026-modern hedefi ve AI araçlarının güncel API bilgisiyle uyum.

**Sonuçlar.** Implementasyon anında "latest stable" yeniden doğrulanır (bu numaralar değişebilir). Major upgrade'ler Changesets ile yönetilir.

---

## ADR-011 — M1 react katmanı: viem + React context (wagmi ertelendi)
**Durum:** Kabul (M1)

**Bağlam.** ADR-003 stack'te wagmi vardı. Ama M1'de social-login için Web3Auth modal v11'in wagmi entegrasyonu (`@web3auth/modal/react/wagmi`) sürüm-oynak ve client ID + tarayıcı olmadan **doğrulanamaz**. Ayrıca kendi `WalletAdapter` soyutlamamız zaten connector katmanını karşılıyor.

**Karar.** M1'de `@avakit/react` **viem + React context** üstüne kuruldu (wagmi değil). `AvaKitProvider` bağlantı durumunu tutar; hook'lar (`useAvaAccount`, `useBalance`, `useContract`, `useAvaDeploy`) viem'i sarar.

**Gerekçe.** Tam kontrol, test edilebilirlik, oynak bir entegrasyona bağımlılık yok. `InjectedAdapter` (Core/MetaMask) M1'in doğrulanmış yolu; `Web3AuthAdapter` `@avakit/core/web3auth` subpath'inde yazıldı/tiplendi ama **canlı testi client ID ile ertelendi**.

**Sonuçlar.** wagmi uyumluluğu gelecekte opsiyonel bir katman olarak eklenebilir (aynı adapter'ı saran bir wagmi connector). Web3Auth adapter'ı izole; SDK API'si değişirse yalnızca tek dosya etkilenir.

---

## ADR-012 — Kütüphanede shadcn: stil-gönder, kopyala-içe-al değil
**Durum:** Kabul (M1)

**Bağlam.** shadcn'in modeli bileşenleri uygulamaya kopyalamaktır; bir npm kütüphanesi (`@avakit/react`) bunu doğrudan yapamaz.

**Karar.** `@avakit/react`, shadcn **stilini** (Radix + Tailwind token'ları) gömülü olarak yollar; tüketici Tailwind'i shadcn token'larıyla yapılandırmış olmalı (scaffolder template'leri ve örnek app bunu sağlar). Bileşenler `bg-primary`, `text-muted-foreground` gibi token sınıfları kullanır.

**Gerekçe.** "shadcn-only" kuralını korur, tek tasarım dili sağlar, vendor lock-in yok. Tailwind v4'te `@source` ile kütüphanenin sınıfları taranır.

**Sonuçlar.** Örnek app `globals.css`'inde `@source "../../../packages/react/src"` ile AvaKit sınıfları taranır. M2 template'leri shadcn'i app içine kopyalar (kanonik shadcn) ve AvaKit hook'larını kullanır.

---

## Bekleyen kararlar
- Default template seti (öneri: `minimal`, `token-gated-app`, `nft-mint`).
- Web3Auth client ID dağıtımı: her dev kendi mi alır, yoksa demo için paylaşılan bir ID mi? (öneri: dev kendi alır, dökümante; demo için throwaway).
- Docs sitesi aracı (öneri: Nextra veya Fumadocs).

İlgili: [Mimari](03-architecture.md) · [PRD](01-prd.md)
