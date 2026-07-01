# 09 — Spec: `@avakit/mcp`

**Rol:** AI yüzeyi. Claude Code / Cursor / Claude Desktop'ın doğal dille Avalanche'de scaffold + deploy + okuma yapmasını sağlayan MCP server.
**Milestone:** M3.
**Bağımlı:** `@avakit/core`, `create-avalanche-app`, `@modelcontextprotocol/sdk`.

## Neden bu MCP, mevcutlardan farklı?
- `utkucy/avalanche-mcp-tools` → Avalanche **CLI**'ı (subnet/L1/VM) sarar.
- Resmi MCP → **docs retrieval**.
- **AvaKit MCP → uygulama kurma + deploy + wire (eylem).** Bu açıyı kimse tutmuyor (bkz. [02](02-competitive-landscape.md)).

## Transport & kurulum
- stdio tabanlı MCP server.
- Claude Code / Cursor / Claude Desktop config örnekleri dökümante edilir:
```json
{
  "mcpServers": {
    "avakit": { "command": "npx", "args": ["-y", "@avakit/mcp"] }
  }
}
```

## Tool yüzeyi

### `scaffold_app`
`create-avalanche-app`'i non-interactive (`--yes`) sarar.
```
input:  { name, template, wallet, chain, directory, packageManager }
output: { path, filesCreated, nextSteps }
```
- Template/wallet/chain manifest'ten doğrulanır; geçersizse açıklayıcı hata.

### `deploy_contract`
`@avakit/core` deploy helper'ı (ADR-005).
```
input:  { artifactPath | { abi, bytecode }, args?, chain, confirm? }
output: { address, txHash, explorerUrl }
```
- **Mainnet için `confirm: true` zorunlu** + bakiye kontrolü (ADR-007). Aksi halde tool reddeder ve neden gerektiğini açıklar.

### `read_chain`
```
input:  { action: 'balance' | 'tx' | 'contractRead', params }
output: ilgili veri (bigint string'leştirilmiş, JSON-safe)
```

### `get_context`
```
input:  { topic? }
output: { markdown }   // resmi llms.txt + AvaKit docs özetinden ilgili bağlam
```
- Resmi Avalanche `llms.txt`'i **tüketir** (kendi docs'unu yazmaz); AvaKit-spesifik bağlamı ekler.

### `list_templates` (yardımcı)
```
output: [{ name, description, supports }]   // manifest'lerden
```

## Tasarım ilkeleri (AI-ergonomi)
- **İdempotent:** Aynı girdi → aynı sonuç; var olan dosyanın üstüne yazmadan önce uyarır.
- **Eyleme dönük hatalar:** "RPC erişilemedi" değil, "Fuji RPC zaman aşımı; faucet/clientId kontrol et: <link>".
- **Küçük, birleşik tool'lar:** Agent zincirler (`scaffold_app` → `deploy_contract` → `read_chain`).
- **Güvenli default:** chain=fuji, mainnet daima explicit + confirm.
- **Yan etkiler şeffaf:** Hangi dosyaların yazıldığı/değiştiği output'ta listelenir.

## Güvenlik
- MCP private key'e dokunmaz; deploy imzası kullanıcının yerel ortamından/adapter'dan gelir.
- Mainnet ve fon harcayan işlemler explicit onay gerektirir.
- Secret'lar (clientId, RPC key) log'a veya tool output'una yazılmaz.

## Örnek uçtan uca senaryo (J1)
```
Kullanıcı: "Avalanche'de bir nft-mint dapp'i kur ve Fuji'ye deploy et."
  → scaffold_app({ template: 'nft-mint', wallet: 'web3auth', chain: 'fuji' })
  → deploy_contract({ artifactPath: 'contracts/out/NFT.sol/NFT.json', chain: 'fuji' })
  → get_context({ topic: 'run-dev-server' })  → kullanıcıya "pnpm dev" talimatı
Sonuç: tarayıcıda Google login + mint. < 5 dk.
```

## Kabul kriteri (M3)
Claude Code'da doğal dil komutuyla scaffold → deploy → çalışır dev sunucusu uçtan uca tamamlanıyor; mainnet işlemleri onaysız reddediliyor.

İlgili: [Scaffolder Spec](08-spec-scaffolder.md) · [AI-Native](10-ai-native-strategy.md) · [ADR-005](04-adr.md)
