# 02 — Rakip Analizi & Prior Art

**Araştırma tarihi:** 2026-07-01
**Soru:** Bu ürünü (scaffolder + embedded wallet SDK + MCP, AI-native, açık kaynak) yapan biri olmuş mu?
**Kısa cevap:** Parçaların hepsi tek tek var; **birleştiren ve AI-native paketleyen kimse yok.** Boşluk gerçek.

---

## Rakip haritası

| Ne | Kim | Kapsıyor | Boşluk / bizim farkımız |
|---|---|---|---|
| Resmi starter kit | `ava-labs/avalanche-starter-kit` | Foundry + Avalanche CLI + Teleporter + Dev Container; cross-chain/eğitim odaklı | ❌ interaktif scaffolder yok · ❌ wallet onboarding yok · ❌ frontend framework yok · ❌ AI context yok |
| React component lib | `ava-labs/builderkit` | `ConnectButton`, `ConnectStatusIndicator`, chain selector, ICTT/faucet flow | ⚠️ injected wallet odaklı; social-login/embedded **dökümante değil**; batteries-included app değil → **biz shadcn/ui üstüne kendi UI'mızı kurarız** (proje kuralı: shadcn-only, [doc 11](11-conventions.md)) |
| Resmi TS SDK | `ava-labs/avalanche-sdk-typescript` | RPC, data/metrics, ICM/Teleporter | düşük seviye yapı taşı; scaffolder/widget/AI değil → **biz kullanırız** |
| Embedded wallet (WaaS) | **AvaCloud WaaS** (Cubist destekli) | Social login (Google/X/FB/Apple), React SDK, pre-built component, HSM key mgmt | ⚠️ **kapalı kaynak + ücretli** (sales, allowlist, subscription), AvaCloud portalına bağlı → **biz açık/ücretsiz alternatif + opsiyonel adapter** |
| Embedded wallet (free) | **Web3Auth / MetaMask Embedded Wallets** | Avalanche C-Chain'de social login, React SDK, ücretsiz tier | chain-agnostic; Avalanche-native paketleme yok → **biz default sağlayıcı yaparız** |
| Wallet (son kullanıcı) | Core / Cubist CubeSigner | Seedless wallet (Google/Apple), HSM | dev SDK/widget değil; son-kullanıcı ürünü |
| MCP (community) | `utkucy/avalanche-mcp-tools` | Avalanche **CLI**'ı sarar: subnet/L1/VM yönetimi | ❌ contract scaffold/deploy/wallet codegen yok |
| MCP (resmi) | build.avax.network + `llms.txt`/`llms-full.txt` | **docs retrieval** + bir miktar canlı data | ❌ uygulama kurma/deploy yok → **biz scaffold+deploy tool'u açarız** |
| Generic scaffolder | Alchemy `create-web3-dapp` | genel web3 scaffold | Avalanche-native değil; social-login-first değil; AI-native değil |

## Boşluk (whitespace) — bizim sahiplendiğimiz

1. **Açık kaynak + ücretsiz, batteries-included scaffolder** ki *default'ta social-login onboarding bağlı gelsin.* Resmi starter-kit'te onboarding hiç yok; AvaCloud'unki ücretli/kapalı. Bu kombinasyon boşta.
2. **AI-native by default** — üretilen her app'in içinde `CLAUDE.md`/`llms.txt`/cursor rules gelmesi + MCP'nin **scaffold+deploy**'u tool olarak açması. Mevcut MCP'ler sadece CLI/docs yapıyor. **Bu açıyı kimse tutmuyor.**
3. **Üç yüzeyi tek çekirdekte birleştiren** ürün yok (scaffolder + widget + MCP).

## Stratejik uyarılar (analizden çıkan)

### Uyarı 1: Embedded wallet'ı sıfırdan yazma
AvaCloud WaaS + Web3Auth bu işi çözmüş, HSM-backed key management ile. Kendi cüzdanımızı yazarsak:
- Güvenlik riski sırtlanırız (yanlış yapılırsa felaket).
- Ava Labs'in fonladığı bir ürünle (WaaS) doğrudan rekabete gireriz.

→ **Karar:** Widget'ımız mevcut **ücretsiz** sağlayıcıyı (Web3Auth) sarar; opsiyonel olarak AvaCloud WaaS adapter'ı sunar. Değerimiz key management değil, paketleme. (bkz. [ADR-001](04-adr.md))

### Uyarı 2: BuilderKit ile ilişki
`ConnectButton` zaten BuilderKit'te var. Onların yapmadığını yapmalıyız: **social-login default + scaffold + AI context.**

> **Güncelleme (proje kuralı):** UI yalnızca **shadcn/ui** olacak ([doc 11](11-conventions.md)); BuilderKit UI **kullanılmaz**. Avalanche-spesifik bileşenleri shadcn üstüne kendimiz kuruyoruz. Trade-off: Ava Labs ile UI seviyesinde çakışma; kazanç: tek tasarım dili + tam kontrol (siyah/beyaz, tema-öncelikli) + AI-ergonomi. Hizalanma, UI yerine *altyapı* (wallet/SDK) seviyesinde sürdürülür.

### Uyarı 3: Resmi MCP/docs ile çakışmama
Resmi MCP docs-retrieval yapıyor. Biz docs değil **eylem** (scaffold/deploy/wire) tool'ları sunarız ve resmi `llms.txt`'i *tüketiriz*. Örtüşme değil tamamlama.

## "Yapılmamış" iddiasının kanıt seviyesi

- **Güçlü kanıt:** Her bireysel parçanın mevcut sağlayıcısı bulundu; açık kaynak + birleşik + AI-native kesişimini sunan tek bir ürün bulunamadı.
- **Belirsizlik:** Çok yeni / az duyurulmuş bir topluluk projesi gözden kaçmış olabilir. M1 öncesi son bir hızlı tarama önerilir (npm `create-avalanche-*`, GitHub `avalanche` + `scaffold`/`mcp` topic'leri).

## Kaynaklar

- https://github.com/ava-labs/avalanche-starter-kit
- https://github.com/ava-labs/builderkit
- https://github.com/ava-labs/avalanche-sdk-typescript
- https://docs.avacloud.io/wallet-as-a-service/getting-started/overview
- https://avacloud.io/blog/avacloud-wallet-as-a-service
- https://docs.metamask.io/embedded-wallets/connect-blockchain/evm/avalanche/
- https://github.com/utkucy/avalanche-mcp-tools
- https://build.avax.network/docs/tooling/ai-llm/mcp-server
- https://cubist.dev/blog/cubist-partners-with-ava-labs-to-power-core-seedless-wallet
- https://github.com/alchemyplatform/create-web3-dapp
