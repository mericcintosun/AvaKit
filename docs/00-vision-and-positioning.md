# 00 — Vizyon & Konumlandırma

## Tek cümle

> **AvaKit, Avalanche'in açık kaynak, AI-native `create-next-app`'idir:** tek komutla social-login onboarding'li, deploy'a hazır, içinde agent context'i gelen bir dapp üretir; ve bunu mevcut parçaları yeniden yazmadan, sararak yapar.

## Bağlam: bu fikir nereden çıktı?

Avalanche TR dev lead'i ile yapılan görüşmede üç sinyal alındı:

1. **Onboarding sürtünmesi** (seed words) — *ama bu zaten çözülmüş.* Core Wallet, Aralık 2023'ten beri Cubist/CubeSigner ile seedless (Google/Apple login) destekliyor. Yani **son kullanıcı** tarafındaki sürtünme kapanmış durumda.
2. **EVM uyumu** — Avalanche C-Chain EVM olduğu için Ethereum tooling'i büyük ölçüde çalışıyor; bu bir avantaj.
3. **"Dev tool eksik + vibe coder friendly olmalı"** — dev lead'in "çok iyi ipucu" dediği ve **gerçek boşluğun olduğu** yer.

## Kritik içgörü

Çözülmemiş olan problem onboarding değil — **geliştiricinin o onboarding'i kullanan bir uygulamayı kurması.**

Core'un seedless'i son kullanıcı için var. Ama yeni veya AI-destekli bir developer "social login'li, deploy edilebilir bir Avalanche dapp'ini 5 dakikada ayağa kaldırayım" dediğinde elinde hazır, çalışan, batteries-included bir başlangıç noktası **yok**. Her şeyi elle wire'lıyor.

**Sürtünme son kullanıcıda değil, dev'de. AvaKit dev sürtünmesini hedefler.**

## Neyi yapmıyoruz (anti-scope)

- **Kendi cüzdanımızı / key management'ımızı yazmıyoruz.** Web3Auth ve AvaCloud WaaS (Cubist destekli, HSM-backed) bunu çözmüş. Yeniden yazmak hem güvenlik riski hem de Ava Labs'in fonladığı bir ürünle rekabet demek.
- **Yeni bir UI component kütüphanesi icat etmiyoruz.** **shadcn/ui**'i benimsiyoruz; Avalanche-spesifik bileşenleri (connect, chain selector) onun primitive'leri üstüne kuruyoruz. (BuilderKit UI kullanılmaz — bkz. [Conventions](11-conventions.md).)
- **Yeni bir chain SDK'sı yazmıyoruz.** viem/wagmi + `avalanche-sdk-typescript` katmanını kullanıyoruz.

## Konumlandırma matrisi

| Eksen | AvaKit'in yeri |
|---|---|
| Açık kaynak vs kapalı | **Açık kaynak (MIT)** — AvaCloud WaaS kapalı/ücretli; bu bizim ayrışma noktamız |
| Eğitim vs üretim | **Üretime hazır** — resmi starter-kit eğitim/cross-chain demo odaklı |
| İnsan-first vs AI-native | **AI-native by default** — üretilen her app agent context'i ile gelir |
| Tek parça vs birleşik | **Birleşik** — scaffolder + widget + MCP tek çekirdekte |

## Değer önerisi, kitleye göre

### Vibe coder (blockchain bilmeyen, Cursor/Claude ile kod yazan)
- `npx create-avalanche-app` veya Claude'a "Avalanche dapp kur" der → MCP halleder.
- Sıfır config, çalışan social-login'li dapp. Seed phrase, RPC URL, faucet derdi yok.

### EVM / Solidity dev (Ethereum'dan geçen)
- Altta tanıdık stack görür: viem/wagmi + Foundry + Next.js.
- `<ConnectAvalanche>` widget'ını mevcut projesine drop-in olarak gömer.
- Vendor lock-in yok; istediği an kendi wallet sağlayıcısına geçer.

## Başarı neye benzer? (kuzey yıldızı)

> Bir geliştiricinin "Avalanche'de bir şey deneyeyim" düşüncesinden, tarayıcıda Google ile giriş yapıp testnet'te ilk transaction'ını gönderen çalışan bir dapp'e kadar geçen süre **< 5 dakika.**

## İsimlendirme

- Ürün/şemsiye: **AvaKit**
- Paketler: `@avakit/core`, `@avakit/react`, `@avakit/mcp`
- CLI: `create-avalanche-app` (`npm create avalanche-app@latest`)

Detaylı persona, hedef ve metrikler için: [PRD](01-prd.md).
