# AvaKit — Known Gaps & Fragilities

> Snapshot from a full-repo review (2026-07-04). Ordered by risk. This is an
> engineering to-do list, not user-facing docs. Update or delete items as they
> are fixed.
>
> **2026-07-04 follow-up pass:** items 1–5 and 8 are now fixed (see below). The
> changes ship in `@avakit/core`, `@avakit/react`, and `create-avalanche-app`.

## Critical / user-visible

1. **Social login was silently hidden without a Web3Auth client ID — FIXED.**
   - Before: `providers.tsx` only added `web3authAdapter` when
     `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` was set, so a fresh scaffold showed only the
     injected (Core/MetaMask) button and social login looked missing.
   - Fix: `WalletAdapter` gained an optional `unavailableReason`; `web3authAdapter`
     sets it when no client ID is configured, and `ConnectAvalanche` now renders
     unavailable adapters as a **disabled button with the hint** instead of hiding
     them. The five social-login templates (minimal, nft-mint, token-gated-app,
     erc20-token, eerc-token) always add the adapter, so the option is
     discoverable ("Add NEXT_PUBLIC_WEB3AUTH_CLIENT_ID to enable social login").
     Verified an injected scaffold (no `@web3auth/modal` installed) still
     typechecks and builds.
   - The wiring matches `@web3auth/modal` v11.2.0's real API (`init()` →
     `connect()` → `Connection.ethereumProvider`, checked against the installed
     SDK types). `web3authAdapter` now has unit tests.
   - **Still open:** a full Google sign-in → Fuji chain-switch has not been
     machine-validated (it needs a human browser login). Test it manually before
     relying on it in a demo.

2. **Mint (and other writes) did not reflect success in the UI — FIXED.**
   - Root cause: `contract.write(...)` returns the tx hash right after broadcast;
     the templates then re-read `totalSupply`/`balanceOf` immediately, racing the
     still-pending tx, so the counts stayed stale and the mint looked like it did
     nothing. A silent on-chain revert was also swallowed.
   - Fix: after `write`, wait for the receipt via
     `getPublicClient(chain).waitForTransactionReceipt({ hash })`, throw on
     `status === "reverted"`, then refresh. Applied to `nft-mint` +
     `token-gated-app` templates and `examples/web3auth-demo`. Smoke-tested.
   - **Still open:** `erc20-token` still uses the raw `write` pattern; the durable
     fix is to bake receipt-waiting into `useContract` in `@avakit/react`.

3. **Mainnet deploy guard was not enforced in core — FIXED.**
   - Before: `deployContract` had no testnet check, so a browser/`@avakit/react`
     caller could deploy to `cChain` (mainnet) unguarded, despite the docs.
   - Fix: `DeployParams` gained `confirmMainnet?: boolean`; `deployContract` throws
     `MainnetConfirmationError` for any `chain.testnet === false` unless
     `confirmMainnet: true` is passed. `useAvaDeploy().deploy(artifact, args, {
     confirmMainnet })` threads it through. Fuji (testnet) is unaffected. Covered
     by tests.

## Testing

4. **`@avakit/react` had zero tests — PARTIALLY FIXED.**
   - Added `utils.test.ts` (11 tests) covering `cn`, `shortenAddress`, and every
     `humanizeError` branch. The provider/hooks/component render paths are still
     untested (would need a jsdom + Testing Library harness) — follow-up.

5. **`@avakit/core` coverage was thin — IMPROVED.**
   - Added `errors.test.ts`, `network.test.ts` (`ensureChain`), and
     `adapters/web3auth.test.ts`, plus the mainnet-guard cases in `deploy.test.ts`.
     Core is now at 29 tests (was 15). Still untested: `data.ts` (RPC helpers).

6. **No integration / e2e coverage.** Smoke tests only scaffold→install→
   typecheck→build. No test drives connect → deploy → mint against a chain, so a
   regression in the mint/deploy flow would not be caught by CI. Follow-up: a
   headless viem/anvil-backed test, or a Playwright flow with a mock provider.

## Fragility

7. **`humanizeError` is brittle string matching.** `packages/react/src/utils.ts`
   maps errors by substring on lowercased messages. Now unit-tested, but still
   breaks on wallet wording changes / localization — the tests will at least flag
   a regression.

8. **`ensureChain` 4902 handling — now tested.** Still relies on numeric
   error-code matching across heterogeneous wallets, but `network.test.ts` locks
   in the switch / add-then-switch / rethrow behavior.

9. **viem overload escape hatches.** `as never` / `as Parameters<...>` casts in
   `deploy.ts`, `data.ts`, and `hooks.ts` (`useContract`, `useSendTransaction`)
   drop type-safety at those call sites to satisfy viem generics. Intentional;
   revisit if viem's typings improve.

10. **Web3Auth SDK is structurally typed**, not using the real SDK types — a
    version bump in `@web3auth/modal` could silently break the adapter with no
    type error. Intentional (keeps the optional dep out of the build), but the
    adapter tests only cover availability, not a live connect.

## Housekeeping

11. **Stale build artifacts.** `.turbo/turbo-test.log` files lag the package
    versions — harmless cache drift, gitignored.

12. **`data-api.ts` past 404 bug** (chain-object vs id) is only documented in a
    comment; worth a regression test given the API surface evolved.

13. **Version constant only correct in built artifacts.** `VERSION` is injected
    at build time; raw `tsc`/`vitest` yields `"0.0.0-dev"`. Expected.
