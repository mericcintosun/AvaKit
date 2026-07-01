# 10 — AI-Native Strateji

> Bu, AvaKit'in **asıl ayrışma noktası.** Scaffolder ve embedded-wallet parçaları bir gün kopyalanabilir; "AI-native by default" konumunu erken ve net sahiplenmek savunulabilir bir avantaj yaratır. Dev lead'in "vibe coder friendly olmalı" ipucunun somut karşılığı budur.

## İlke: bağlam, üretilen artefakta gömülüdür

Çoğu proje AI desteğini "dışarıda" (ayrı bir docs MCP) bırakır. AvaKit bağlamı **ürettiği her dapp'in içine** koyar; böylece geliştirici Cursor/Claude'u açtığı an ajan Avalanche + AvaKit'i zaten "biliyor".

## Üç katman

### Katman 1 — Üretilen app içindeki context dosyaları
`create-avalanche-app` her projeye ekler:

**`CLAUDE.md`** (ajan için operasyonel rehber)
- Proje mimarisi: hangi dosya ne yapar (`app/providers.tsx`, `lib/avakit.ts`, `contracts/`).
- AvaKit API hatırlatmaları: `<ConnectAvalanche>`, `useAvaAccount`, deploy helper.
- Yaygın görevler: "contract ekle", "yeni sayfa", "Fuji'ye deploy", "wallet provider değiştir".
- **Yapma kuralları:** "Private key'i koda yazma", "mainnet'e onaysız deploy etme", "RPC URL'i hardcode etme — env kullan".
- Komutlar: `pnpm dev`, `pnpm deploy:fuji`, `pnpm typegen`.

**`llms.txt`** (proje haritası, AI-friendly)
- Dosya/dizin haritası + önemli giriş noktaları + harici docs linkleri (resmi Avalanche `llms.txt`).

**`.cursor/rules/avakit.mdc`**
- Cursor için aynı bağlam, Cursor rule formatında.

### Katman 2 — MCP tool'ları (eylem)
`@avakit/mcp` ajana docs değil **yapabilme** verir: `scaffold_app`, `deploy_contract`, `read_chain`, `get_context`. (bkz. [09](09-spec-mcp.md)). Resmi `llms.txt`'i tüketir, kendi docs'unu yeniden yazmaz.

### Katman 3 — AvaKit'in kendi dokümantasyonu AI-friendly
- Tüm AvaKit docs `.md` olarak erişilebilir + bir `llms.txt` index.
- API referansları kısa, kopyalanabilir, "tek doğru yol" örnekleriyle (ajan yanlış pattern üretmesin).

## Tasarım kuralları (AI çıktısının kalitesi için)
1. **Tek kanonik yol.** Aynı işi yapmanın tek önerilen yolu olsun; ajan alternatifler arasında savrulmasın. (ör. her zaman `<ConnectAvalanche>`, elle Web3Auth kurma yok.)
2. **Tipler sözleşmedir.** Uçtan uca TS + ABI tipgen → ajanın ürettiği kod compile-time'da doğrulanır.
3. **Eyleme dönük hatalar.** Hata mesajı bir sonraki adımı söyler (faucet linki, eksik env). Ajan kendini düzeltebilsin.
4. **Güvenli default'lar makinede de geçerli.** chain=fuji, mainnet explicit+confirm — ajan yanlışlıkla mainnet'e deploy edemez.
5. **Yan etki şeffaflığı.** Scaffolder/MCP hangi dosyayı yazdığını döker; ajan ve insan ne olduğunu görür.

## `CLAUDE.md` şablon iskeleti (üretilen app için)
```md
# <ProjectName> — Avalanche dapp (AvaKit ile üretildi)

## Stack
Next.js 16 (App Router) · React 19 · @avakit/react · @avakit/core · wagmi/viem · shadcn/ui · next-themes · Foundry
(UI: shadcn-only, black & white until M3, dark/light from day one, animations via Framer Motion)

## Mimari
- app/providers.tsx — <AvaKitProvider> (wallet + chain config)
- lib/avakit.ts — chain ve adapter
- contracts/ — Foundry; out/ artefact'ları

## Yaygın görevler
- Wallet butonu: `<ConnectAvalanche />`
- Hesap: `useAvaAccount()`; Bakiye: `useBalance()`
- Deploy (testnet): `pnpm deploy:fuji`

## Kurallar
- Private key / secret'ı koda yazma; .env kullan.
- Mainnet deploy: önce onay + bakiye kontrolü.
- Yeni contract → `pnpm typegen` çalıştır.
```

## Başarı ölçütü
- Yeni bir dev Cursor/Claude açtığında, AvaKit'i hiç bilmeden, ajanın ilk denemede çalışan + doğru pattern'li kod üretmesi.
- MCP ile uçtan uca "scaffold → deploy → çalışır dev" doğal dille tamamlanır.

İlgili: [Scaffolder](08-spec-scaffolder.md) · [MCP](09-spec-mcp.md) · [Vizyon](00-vision-and-positioning.md)
