# AvaKit QA / DX Feedback Report

**Date:** 2026-07-02 · **Tested from published npm releases** (not source)
**Versions under test:** `create-avalanche-app@0.1.9` · `@avakit/core@0.1.2` · `@avakit/react@0.1.3` · `@avakit/mcp@0.1.9` · `@avakit/studio@0.1.6`

---

## 1. Environment

| Item | Value |
|---|---|
| OS | macOS 26.5.1 (Darwin 25.5.0, Apple Silicon) |
| Node | v24.15.0 |
| Package manager | pnpm **10.20.0** (system) — note: `create-avalanche-app` installs with its own bundled **pnpm 11.1.3** |
| npm | 11.12.1 |
| avalanche-cli | 1.9.6 |
| Foundry | forge/cast 1.7.1 |
| Web3Auth client ID | **none** → social login **untested**; injected-wallet path reviewed instead |
| Browser wallet / Fuji AVAX | **none** → in-browser wallet click-through flows untested; every contract flow was instead **proven at the RPC level** with `cast` + the EWOQ key (local chains) and `anvil` (bundled artifacts) |
| Port 3000 | occupied by an unrelated local process, so all `pnpm dev` checks ran on ports 3100–3107 |

---

## 2. Results table

| Item | Status | One-liner |
|---|---|---|
| `create-avalanche-app` (scaffolder) | **WORKS** | All 8 templates scaffold + install cleanly; `--help/--version/--yes/--pm npm/--wallet/--chain/--no-install` all behave |
| minimal | **WORKS** | install/typecheck/build/dev all clean, page renders connect+balance+tx UI |
| nft-mint | **WORKS** | Builds & runs; bundled ERC-721 artifact deploys + `mint()` verified on anvil (`"AvaKit NFT"`, balance 1) |
| token-gated-app | **WORKS** | Builds & runs; access-pass NFT artifact deploys + mints on anvil |
| erc20-token | **WORKS** | Builds & runs; bundled ERC-20 deploys, `mint()` (100 AKT) + `transfer` verified on anvil |
| icm-messenger | **WORKS** (with caveat) | Full E2E proven: 2 L1s + relayer up, messenger deployed on both, cross-chain message arrived in ~3 s. Caveat: `pnpm devnet` is **not idempotent** (see §3.5) |
| eerc-token | **PARTIAL (verified where possible)** | Builds & runs; all 10 circuit CDN URLs return 200; shared Fuji contract live (`name() = "Test"`). Browser ZK register/mint/transfer untested (needs wallet + Fuji AVAX) |
| l1-launch | **WORKS** | `pnpm l1` → mychain (chainId 9999) live, EWOQ pre-funded 1M, demo token deployed via RPC (`"AvaKit Token"/AKT`), dashboard UI renders. `pnpm l1:fuji` untested (needs funded key + always-on node) |
| token-bridge | **PARTIAL — real bug** | `pnpm bridge` works; bridge **out** arrives in ~3 s; bridge **back reverts** with `ERC20InsufficientAllowance` — the app never approves in the remote→home direction (see §3.8, top fix #1) |
| @avakit/studio | **WORKS** | Dashboard + token-protected API all healthy: env detection, devnet status, ICM state (saw live chains), Data lookup on Fuji. `studio mcp` exposes 10 tools. Fuji wizard's fund/transfer steps untested (needs AVAX) |
| @avakit/mcp | **WORKS** | All 5 tools exercised: list_templates, scaffold_app (16 files), read_chain (balance/contractRead/validation), get_context, deploy_contract incl. **mainnet guardrail confirmed** (“Refusing to deploy to Avalanche C-Chain (mainnet) without confirm:true.”) |
| @avakit/core | **WORKS** | Every documented export exists; Data API helpers return live Fuji data. DX nit: `chainId: number` vs `AvaChain` inconsistency (§3.10) |
| @avakit/react | **WORKS** | All documented components + 10 hooks present in the published build; templates use them and typecheck |

---

## 3. Per-item detail

### 3.1 Scaffolder — `create-avalanche-app@0.1.9`

Commands run:

```bash
npx -y create-avalanche-app@latest --help        # exit 0, accurate flag list
npx -y create-avalanche-app@latest --version     # 0.1.9
npm create avalanche-app@latest <t>-test -- --template <t> --yes   # ×8, all exit 0
npx -y create-avalanche-app@latest variant-injected --template minimal --wallet injected --yes --no-install
npx -y create-avalanche-app@latest variant-cchain  --template minimal --chain c-chain  --yes --no-install
npx -y create-avalanche-app@latest variant-npm     --template minimal --pm npm --yes
```

What worked:
- All 8 templates scaffolded and installed with **zero errors** (7–10 s each with warm store).
- **`pnpm-workspace.yaml` ships with `allowBuilds` (sharp, protobufjs, tiny-secp256k1) and `minimumReleaseAgeExclude` for `@avakit/*`** — this is excellent; on pnpm 10.20 there were no `ERR_PNPM_IGNORED_BUILDS` issues and `pnpm ignored-builds` reports “None”. The classic pnpm-10 sharp trap is fully preempted.
- `--wallet injected` removes `@web3auth/modal` from deps and drops the `.env` line from next-steps. Verified the resulting app installs, typechecks, and builds — even with `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` set (the web3auth adapter dynamic-imports `@web3auth/modal` in a try/catch → graceful `WalletNotAvailableError`). Sound design.
- `--chain c-chain` correctly switches `providers.tsx` to `cChain`.
- `--pm npm` produced a working npm install with `package-lock.json`.
- MCP `scaffold_app` refuses to overwrite a non-empty directory. 

Friction found:
1. **Next-steps message is wrong for the devnet templates.** After scaffolding `icm-messenger`, `l1-launch`, and `token-bridge`, the CLI prints only:
   ```
   cd icm-messenger-test
   cp .env.example .env.local   # add your Web3Auth client ID
   pnpm run dev
   ```
   The **required first step (`pnpm devnet` / `pnpm l1` / `pnpm bridge`) is missing**, and the Web3Auth line is irrelevant noise for local-devnet templates whose wallets are injected+EWOQ. A user following the printed steps lands on a UI pointing at a devnet that doesn't exist.
2. `--wallet injected` still ships `.env.example` with the Web3Auth comment, and `providers.tsx` is byte-identical to the web3auth variant. Deliberate progressive enhancement, but the flag reads like it should produce an injected-only app; at minimum drop `.env.example` there like the next-steps message already does.
3. Scaffolder installs with its **bundled pnpm 11.1.3** regardless of the system pnpm (10.20.0 here). Nothing broke in mixed use, but the lockfile is produced by pnpm 11 — worth a mention in docs for teams pinning pnpm 10.

### 3.2 minimal — WORKS

```
pnpm typecheck  → exit 0
pnpm build      → ✓ Compiled successfully in 6.5s, 3/3 static pages
pnpm dev -p 3100 → Ready in 304ms, GET / 200
```
Page renders: “Your first transaction on Avalanche — Connect a wallet, read your balance, and send a 0-AVAX transaction to yourself on Avalanche Fuji.” README/CLAUDE.md match the shipped code (checked providers.tsx, demo.tsx, hooks named in CLAUDE.md all exist in the published `@avakit/react`).

Minor: every template build/dev prints Next.js’ *“inferred your workspace root … multiple lockfiles”* warning (the app-level `pnpm-workspace.yaml` plus any stray lockfile in `$HOME` triggers it). Setting `turbopack.root` in the generated `next.config.ts` would silence it for everyone.

### 3.3 nft-mint — WORKS
typecheck/build/dev all clean; UI renders deploy+mint flow. Bundled artifact proven on anvil:
```
deployed: 0x5fbd…0aa3 · mint() OK · name() = "AvaKit NFT" · balanceOf = 1
```
In-browser wallet click-through untested (no browser wallet), but bytecode/ABI are valid and the deploy path uses the same `useAvaDeploy` verified in §3.12.

### 3.4 token-gated-app / erc20-token — WORKS
Same result set: typecheck/build/dev clean, pages render the documented flows.
- erc20 artifact: `mint()` → 100 AKT, `transfer()` OK on anvil.
- access-pass NFT artifact: deploy + `mint()` → balance 1 on anvil.

### 3.5 icm-messenger — WORKS, but `pnpm devnet` is not idempotent

**First run failed** on this machine (pre-existing avalanche-cli state):
```
Starting previously deployed and stopped snapshot
Network ready to use.
Error: blockchain chain1 has already been deployed
✖ Deploy of 'chain1' failed.
[ELIFECYCLE] Command failed with exit code 1.
```
The script’s `blockchain create --force` succeeds, but `blockchain deploy` dies on any leftover network state, and the failure message doesn’t tell you the remedy (`avalanche network clean` — it *is* in the README’s “Reset the devnet” section, but not in the error output where you need it).

After `avalanche network stop && avalanche network clean`, `pnpm devnet` succeeded and wrote a correct `icm.config.json` (RPCs + hex blockchain IDs for chain1/chain2 + TeleporterMessenger address).

**Full E2E then proven over RPC with the EWOQ key** (exact flow the UI performs):
```
deploy AvaKitMessenger on chain1 + chain2 (bundled bytecode, 2316 bytes)   → OK
sendMessage(chain2_blockchainID, messenger2, "hello from QA agent")       → status 0x1
chain2.lastMessage() = "hello from QA agent"   ← RECEIVED after ~3 s
chain2.messagesReceived() = 1
```
The README’s “bytes32 blockchain ID, not EVM chainId” gotcha note is accurate and appreciated. `pnpm dev` renders both chains from the config.

### 3.6 eerc-token — PARTIAL (everything verifiable was verified)
- typecheck/build/dev clean; UI renders the register/mint/transfer/burn flow copy.
- All **10 circuit files** (register/mint/transfer/withdraw/burn × wasm/zkey) at the pinned jsDelivr commit `c7eb0e09…` return **HTTP 200**.
- The shared Fuji deployment `0xfB27bcdb845ECF231a36f3d14466e9ce9CF98d58` has code and answers `name() = "Test"` — matches the “name Test, symbol TEST, 2 decimals” comment in `lib/eerc-config.ts`.
- **Untested:** actual in-browser ZK proof generation and the register→mint→transfer→burn lifecycle (needs a browser wallet + Fuji AVAX; mint is owner-gated on the shared instance as documented).

### 3.7 l1-launch — WORKS
`pnpm l1` succeeded **even while the ICM chains were still running** (adds `mychain` to the running local network) and wrote `l1.config.json`. Verified live:
```
cast chain-id → 9999 · EWOQ balance = 1,000,000 MYL1
demo token deployed via RPC → name "AvaKit Token", symbol "AKT"
```
Dashboard UI (port 3106) renders chain stats, explorer panes, deploy-demo-token button, and correct EWOQ instructions. `pnpm l1:fuji` not tested (needs a funded key + an always-on node) — flagging as untested, not broken.

Note: `l1.config.json` embeds the EWOQ private key under `faucetAccount.privateKey`. It’s a public dev key so it’s fine, but consider a `// public EWOQ dev key` note inside the JSON to keep secret-scanners and copy-pasters calm.

### 3.8 token-bridge — PARTIAL: bridge-back is broken in the shipped app logic

Setup (`pnpm bridge`, after a network clean) worked: two L1s, relayer, demo ERC-20, TeleporterRegistry ×2, Home, Remote all deployed and registered; `bridge.config.json` written. Foundry was **not** needed — contrary to the docs-site requirements hint (bytecode is bundled; README correctly says “no Solidity toolchain”).

**E2E out (chain1 → chain2): WORKS.** Using the exact input struct the app builds (`components/demo.tsx`):
```
mint() 100 TOK1 → approve(home) → home.send(...) status 0x1
remote.balanceOf on chain2 = 1e18   ← ARRIVED after ~3 s
```

**E2E back (chain2 → chain1): REVERTS.** The app only approves when `toRemote` (code comment: *“The remote token is burned on send back — no approval”*), but the deployed `ERC20TokenRemote.send` pulls tokens via `transferFrom`:
```
Error: … execution reverted: ERC20InsufficientAllowance(0x17aB05351fC94a1a67Bf3f56DdbB941aE6c63E25, 0, 1000000000000000000)
```
**Fix verified live:** after `approve(remote, amount)` **on the remote token itself**, the identical `send` succeeded and the original unlocked on chain1 (balance 199 → 200 TOK1). So the swap-direction path in the UI will revert for every user. One-line fix: run the approval branch in both directions (or approve `remote` for the remote→home leg).

### 3.9 @avakit/studio 0.1.6 — WORKS
- `npx @avakit/studio` → banner + `http://127.0.0.1:57367/` (random port). SPA served; **all `/api/*` endpoints are session-token protected** (token injected into `index.html`, checked via `x-studio-token`) and host-allowlisted — good local security posture.
- Walked the API behind every view: `/api/health` ok; `/api/env` correctly detected avalanche-cli 1.9.6, forge, cast, node, and that the cwd isn’t an AvaKit project; `/api/devnet/status` listed all local L1 configs incl. stale ones with accurate running/deployed flags; `/api/icm/state` showed the live bridge chains with messenger + RPC; `/api/data?address=…&chain=fuji` returned real balances/tokens; `/api/fuji/key` → `{"error":"not found"}` and `/api/fuji/balance` → `{address:null,cBalance:"0"}` (sensible empty states).
- **Untested:** pressing the devnet spin-up / Fuji wizard buttons end-to-end (devnet actions would have clobbered the running bridge network; Fuji create+fund+deploy needs ~1–2 AVAX).
- `npx @avakit/studio mcp` → initialize OK (`avakit-studio 0.1.6`), 10 tools listed (avalanche_env, devnet_status/spin_up/launch_l1/start/stop, icm_state/deploy_messengers/send, data_lookup).

Rough edge: the printed URL carries no session token and the SPA gets it via inline script — fine — but if a user opens the printed URL after a studio restart, a stale tab’s token 401s with no visible hint. Cosmetic.

### 3.10 @avakit/mcp 0.1.9 — WORKS
All five tools exercised over raw stdio JSON-RPC:
- `list_templates` → 8 templates with `contracts` flags.
- `scaffold_app` → 16 files, correct refusal on non-empty target.
- `read_chain` balance → live Fuji wei/avax; `contractRead` → `name() = "Test"` on the eERC contract; invalid `action` → clean zod validation error listing valid values.
- `get_context` → accurate API surface (matches shipped exports).
- `deploy_contract`: **mainnet guardrail confirmed** — `chain: "c-chain"` without `confirm:true` returns *“Refusing to deploy to Avalanche C-Chain (mainnet) without confirm:true.”* With `AVAKIT_DEPLOYER_KEY` set to an unfunded throwaway key on fuji it correctly attempted and surfaced viem’s insufficient-funds error verbatim.

DX nit that bit me: the tools accept **unknown params silently** (zod strips them). I first passed `network: "mainnet"` (wrong name; real param is `chain`) and the tool quietly deployed to the **default fuji**. For an AI-facing tool, silently ignoring an unknown targeting parameter is risk-adjacent — `.strict()` schemas would turn typos into loud errors.

### 3.11 @avakit/core 0.1.2 — WORKS
Enumerated the published exports; **everything in the docs exists**: `fuji`, `cChain`, `chains`, `defineChain` (also under `@avakit/core/chains`), `injectedAdapter`, `web3authAdapter` (under `/web3auth`), `getPublicClient`, `getWalletClient`, `ensureChain`, `toViemChain`, `deployContract`, `getBytecode`, `getBalance`, `getTransactionReceipt`, `readContract`, Data API helpers + typed errors (`AvaKitError`, `ChainMismatchError`, …). ESM-only (no CJS `require`) — fine, worth one line in the README.

Data API helpers verified live (keyless, Fuji): `getNativeBalance`, `listErc20Balances`, `listNfts`, `listTransactions` all returned real data.

DX friction: **signature inconsistency** — RPC helpers take an `AvaChain` object (`getBalance(address, fuji)`) while Data API helpers take `chainId: number` (`getNativeBalance(address, 43113)`). Passing the chain object (the natural guess) yields a confusing remote 404:
```
Data API request failed (404): {"error":"Not Found","details":"Chain config not found for chain ID: [object Object]"}
```
Docs don’t show these signatures. Accept `number | AvaChain`, or at least type-narrate it in the docs.

### 3.12 @avakit/react 0.1.3 — WORKS
Published exports: `AvaKitProvider`, `ConnectAvalanche`, `TransactionButton`, `Button`, `buttonVariants`, `cn`, `shortenAddress`, `VERSION`, and hooks `useAvaAccount`, `useAvaChain`, `useAvaDeploy`, `useAvaKit`, `useBalance`, `useContract`, `useNfts`, `useSendTransaction`, `useTokenBalances`, `useTxHistory` — **a 1:1 match with the docs page** (docs list ten hooks; all ten exist). Templates import them and typecheck against the published `.d.ts`.

---

## 4. Missing / mismatched

1. **Docs “requirements” vs reality (in the good direction):** token-bridge (and nft-mint / erc20-token / token-gated-app / icm-messenger) do **not** need Foundry at runtime — bytecode is bundled. The templates page’s “Foundry contract” requirement chips read as prerequisites; they scare users away needlessly. Only contract *editing* needs forge.
2. **Scaffolder next-steps omit the devnet step** for icm-messenger / l1-launch / token-bridge (§3.1.1).
3. **No documented recovery path in the failure itself** when `pnpm devnet`/`pnpm bridge` hits pre-existing avalanche-cli state (§3.5) — the info lives in the README but not in the error message.
4. **Cross-template chain-name collision undocumented:** icm-messenger and token-bridge both hard-code `chain1`/`chain2` (1001/1002). Running one template’s devnet after the other fails with `blockchain chain1 has already been deployed` until a full `avalanche network clean`. Nothing in either README says the two templates are mutually exclusive on one machine.
5. Docs quickstart says `cp .env.example .env.local` unconditionally — for `--wallet injected` scaffolds there’s nothing to put in it.
6. `/docs/core` doesn’t show Data API helper signatures (the `chainId: number` trap, §3.11).
7. Social login E2E (Web3Auth) has no CI-testable story; not a bug, but it means the default wallet path of every template is only smoke-tested by whoever owns a client ID.

---

## 5. Top fixes (prioritized)

1. **token-bridge: approve on the remote→home leg.** Repro: `pnpm bridge` → mint → bridge 1 TOK1 to chain2 (works) → swap direction → bridge back → `ERC20InsufficientAllowance(remote, 0, 1e18)` revert. Fix confirmed live: `approve(remote, amount)` on the remote token before `remote.send(...)` — after that the original unlocks on chain1. One conditional in `components/demo.tsx` (and delete the now-wrong comment).
2. **Make the devnet scripts idempotent** (`icm-messenger/scripts/devnet.sh`, `token-bridge/scripts/bridge.sh`, `l1-launch/scripts/l1.sh`). Repro: any leftover local network → `Error: blockchain chain1 has already been deployed`, exit 1. Detect the state and either (a) offer/auto-run `avalanche network clean`, or (b) print the exact recovery command in the `die` message. Bonus: give each template unique chain names (e.g. `icm1/icm2`, `br1/br2`) so the two devnet templates stop colliding.
3. **Fix the scaffolder’s next-steps for devnet templates.** Print `pnpm devnet` / `pnpm l1` / `pnpm bridge` as step 1 and drop the Web3Auth line where it doesn’t apply. Repro: scaffold icm-messenger, follow printed steps verbatim → app with no chains.
4. **`@avakit/mcp`: make tool schemas `.strict()`.** Repro: call `deploy_contract` with `network:"mainnet"` (wrong param name) → silently deploys to fuji default. For agent-facing deploy tooling, unknown keys should be hard errors.
5. **Data API helpers: accept `AvaChain | number` (or document the number-only signature).** Repro: `getNativeBalance(addr, fuji)` → remote 404 `Chain config not found for chain ID: [object Object]`.
6. **Silence the Next.js workspace-root warning** by setting `turbopack.root` in generated `next.config.ts` — it appears on every build/dev of every template and reads like something is wrong.
7. Small docs pass: mark Foundry as “only to modify contracts”; note ESM-only for `@avakit/core`; document the pnpm-11-generated lockfile; document icm↔bridge mutual exclusivity until #2 lands.

---

## Overall impression

Honest bottom line: this is one of the smoothest pre-1.0 web3 scaffolder experiences I’ve tested. 8/8 templates install, typecheck, build, and run with zero errors on the current pnpm; the pnpm-10 native-build trap is preempted in the shipped workspace config; the hard multi-chain flows (ICM message, own L1, ICTT bridge-out) all worked end-to-end on the first properly-clean run, with messages/tokens landing in ~3 s; and the published packages match their docs 1:1, which is rare. The two things that would actually hurt a new user are the bridge-back revert (a genuine shipped bug) and the non-idempotent devnet scripts (first-command failure on any machine with old avalanche-cli state). Both are small, well-localized fixes.
