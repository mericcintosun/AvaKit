# 06 — Spec: `@avakit/core`

> **Historical planning document** — written before implementation. AvaKit has since shipped (published on npm, 8 templates, live website); treat the root `README.md` and the website docs as the current source of truth.

**Role:** Kernel. Framework-agnostic TypeScript. Depends only on viem. All other surfaces consume it.
**Milestone:** M1.

> Note: The signatures below express **design intent**; the final API will crystallize in the code. The goal is to lock down the contract, not a line-by-line implementation.

## Modules

### 1. Chain registry
Predefined chains + adding a custom L1.

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
Sets up viem clients with standard Avalanche defaults (chain, transport).

### 3. WalletAdapter interface (provider abstraction)
```ts
interface WalletAdapter {
  readonly id: 'web3auth' | 'avacloud' | 'injected' | string
  connect(opts?: ConnectOptions): Promise<{ address: `0x${string}` }>
  disconnect(): Promise<void>
  getAddress(): Promise<`0x${string}` | null>
  getSigner(): Promise<EIP1193Provider>   // the viem walletClient is fed from here
  on(event: 'connect' | 'disconnect' | 'chainChanged', cb: (...a: any[]) => void): void
}
```

Provided adapters:
- `Web3AuthAdapter(config)` — **default.** Social login (Google/Apple/email). Takes a Client ID.
- `InjectedAdapter()` — injected wallets like Core/MetaMask (EIP-1193).
- `AvaCloudAdapter(config)` — opt-in, M3+.

**Security rule:** The adapter only exposes a signing interface (`getSigner`). The private key never passes through AvaKit code; the provider holds it in an HSM/enclave.

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
- Reads the Foundry `out/*.json` format (ADR-004).
- Waits for the tx, returns the address + explorer link.

### 5. Data (reads)
```ts
function getBalance(addr: `0x${string}`, chain: AvaChain): Promise<bigint>
function readContract<T>(params: ReadContractParams): Promise<T>   // viem passthrough
function getTransaction(hash: `0x${string}`, chain: AvaChain): Promise<TxReceipt>
```
- Primary source: RPC (viem). Optional: Glacier/AvaCloud Data API enrichment (M3+).

## Error handling
- Typed error classes: `WalletNotConnectedError`, `ChainMismatchError`, `DeployFailedError`, `InsufficientFundsError` (puts the faucet link in the message).
- Errors carry an **actionable** message (AI ergonomics: the agent should understand what to do).

## Dependencies
- `viem` (required), `abitype` (types).
- NO React. The Web3Auth SDK is lazy-imported only inside `Web3AuthAdapter`.

## Test coverage (M1 exit)
- Chain registry + custom L1.
- Web3AuthAdapter connect/disconnect (mock + Fuji integration).
- The deploy helper deploys a real contract on Fuji (integration test).
- Data read functions.

Related: [Architecture](03-architecture.md) · [Widget Spec](07-spec-wallet-widget.md) · [ADR-001](04-adr.md)
