# 06 — Spec: `@avakit/core`

**Rol:** Kernel. Framework-agnostic TypeScript. Sadece viem'e bağımlı. Diğer tüm yüzeyler bunu tüketir.
**Milestone:** M1.

> Not: Aşağıdaki imzalar **tasarım niyetini** gösterir; nihai API kodda netleşir. Amaç sözleşmeyi sabitlemek, satır satır implementasyon değil.

## Modüller

### 1. Chain registry
Önceden tanımlı zincirler + custom L1 ekleme.

```ts
import { fuji, cChain } from '@avakit/core/chains'

interface AvaChain {
  id: number
  name: string
  rpcUrl: string
  explorerUrl: string
  faucetUrl?: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  testnet: boolean
}

function defineChain(config: AvaChain): AvaChain
```
- `fuji` (testnet, default), `cChain` (mainnet).
- Custom L1: `defineChain({ id, name, rpcUrl, explorerUrl, ... })`.

### 2. Client factory
```ts
function createPublicClient(chain: AvaChain): PublicClient   // viem
function createWalletClient(chain: AvaChain, adapter: WalletAdapter): WalletClient
```
viem client'larını standart Avalanche default'larıyla (chain, transport) kurar.

### 3. WalletAdapter arayüzü (provider soyutlaması)
```ts
interface WalletAdapter {
  readonly id: 'web3auth' | 'avacloud' | 'injected' | string
  connect(opts?: ConnectOptions): Promise<{ address: `0x${string}` }>
  disconnect(): Promise<void>
  getAddress(): Promise<`0x${string}` | null>
  getSigner(): Promise<EIP1193Provider>   // viem walletClient buradan beslenir
  on(event: 'connect' | 'disconnect' | 'chainChanged', cb: (...a: any[]) => void): void
}
```

Sağlanan adapter'lar:
- `Web3AuthAdapter(config)` — **default.** Social login (Google/Apple/email). Client ID alır.
- `InjectedAdapter()` — Core/MetaMask gibi enjekte cüzdanlar (EIP-1193).
- `AvaCloudAdapter(config)` — opt-in, M3+.

**Güvenlik kuralı:** Adapter yalnızca imzalama arayüzü (`getSigner`) sunar. Private key AvaKit kodundan geçmez; provider HSM/enclave'de tutar.

### 4. Deploy helper
```ts
interface DeployInput {
  artifact: FoundryArtifact | { abi: Abi; bytecode: `0x${string}` }
  args?: unknown[]
  chain: AvaChain
  adapter: WalletAdapter
}
interface DeployResult { address: `0x${string}`; txHash: `0x${string}`; explorerUrl: string }

function deployContract(input: DeployInput): Promise<DeployResult>
function loadFoundryArtifact(path: string): FoundryArtifact   // out/Foo.sol/Foo.json
```
- Foundry `out/*.json` formatını okur (ADR-004).
- Tx'i bekler, adres + explorer linki döner.

### 5. Data (okuma)
```ts
function getBalance(addr: `0x${string}`, chain: AvaChain): Promise<bigint>
function readContract<T>(params: ReadContractParams): Promise<T>   // viem passthrough
function getTransaction(hash: `0x${string}`, chain: AvaChain): Promise<TxReceipt>
```
- Birincil kaynak: RPC (viem). Opsiyonel: Glacier/AvaCloud Data API zenginleştirme (M3+).

## Hata yönetimi
- Tipli hata sınıfları: `WalletNotConnectedError`, `ChainMismatchError`, `DeployFailedError`, `InsufficientFundsError` (faucet linkini mesaja koyar).
- Hatalar **eyleme dönük** mesaj içerir (AI ergonomisi: agent ne yapacağını anlasın).

## Bağımlılıklar
- `viem` (zorunlu), `abitype` (tipler).
- React YOK. Web3Auth SDK yalnızca `Web3AuthAdapter` içinde lazy import.

## Test kapsamı (M1 çıkış)
- Chain registry + custom L1.
- Web3AuthAdapter connect/disconnect (mock + Fuji entegrasyon).
- Deploy helper Fuji'de gerçek bir contract deploy eder (integration test).
- Data okuma fonksiyonları.

İlgili: [Mimari](03-architecture.md) · [Widget Spec](07-spec-wallet-widget.md) · [ADR-001](04-adr.md)
