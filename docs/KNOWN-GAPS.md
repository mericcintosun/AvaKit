# AvaKit — Known Gaps & Fragilities

> Snapshot from a full-repo review (2026-07-04). Ordered by risk. This is an
> engineering to-do list, not user-facing docs. Update or delete items as they
> are fixed.

## Critical / user-visible

1. **Social login button hidden unless a Web3Auth client ID is configured.**
   - `providers.tsx` only adds `web3authAdapter` when
     `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` is set. A fresh scaffold ships an empty
     `.env.example`, so a just-scaffolded app shows **only** the injected
     (Core/MetaMask) button — which reads as "social login is missing."
   - This is **config, not a code bug**: the wiring is correct and the adapter
     matches `@web3auth/modal` v11.2.0's real API (`init()` → `connect()` →
     `Connection.ethereumProvider`, verified against the installed SDK types).
     Set the (free, public) client ID from dashboard.web3auth.io in `.env.local`
     and the social-login button appears. `examples/web3auth-demo/.env.local`
     already has a working one.
   - Still-open risk: the adapter has **no automated test** and a full Google
     sign-in → Fuji chain-switch has not been machine-validated (can't be, it
     needs a human browser login). Test it manually before relying on it.
   - DX improvement worth doing: when scaffolded for `web3auth` but the client ID
     is missing at runtime, surface a hint instead of silently hiding the button.

2. **Mint (and other writes) did not reflect success in the UI — FIXED.**
   - Root cause: `contract.write(...)` returns the tx hash right after broadcast;
     the templates then called `refreshCounts()`/`refreshOwned()` immediately,
     racing the still-pending tx, so `totalSupply`/`balanceOf` stayed at their
     old values and the mint looked like it failed. A silent on-chain revert was
     also swallowed with no user feedback.
   - Fix (2026-07-04): after `write`, wait for the receipt via
     `getPublicClient(chain).waitForTransactionReceipt({ hash })`, throw on
     `status === "reverted"`, then refresh. Applied to `nft-mint` +
     `token-gated-app` templates and `examples/web3auth-demo`. Verified: typecheck
     clean, `getPublicClient(...).waitForTransactionReceipt` confirmed at runtime.
   - Durable follow-up: bake receipt-waiting into `useContract` in
     `@avakit/react` so every template gets it for free (needs a react republish;
     `erc20-token` still uses the raw `write` pattern).

3. **`testnet` guard is not enforced in core deploy.**
   - `packages/core/src/chains.ts` comments claim mainnet deploys "require
     explicit confirmation / opt-in," but `deployContract`
     (`packages/core/src/deploy.ts`) has **no** such guard — it will deploy to
     `cChain` (mainnet) with no confirmation. The guard only exists at the MCP
     layer (`deploy_contract` needs `confirm:true`). Comment/behavior mismatch;
     a browser/`@avakit/react` caller can hit mainnet unguarded.

## Testing

4. **`@avakit/react` has zero tests.** The entire provider/hooks/UI surface
   (the part users actually touch) is untested. `vitest run --passWithNoTests`.

5. **`@avakit/core` coverage is thin.** 5 files / ~15 tests, happy-path only on
   pure functions. Untested: `network.ts` (`ensureChain`), `data.ts` (RPC),
   `errors.ts`, and the riskiest module `adapters/web3auth.ts`.

6. **No integration / e2e coverage.** Smoke tests only scaffold→install→
   typecheck→build. No test drives connect → deploy → mint against a chain,
   so regressions in the two critical bugs above would not be caught by CI.

## Fragility

7. **`humanizeError` is brittle string matching.** `packages/react/src/utils.ts`
   maps errors by substring on lowercased messages (user-rejected, insufficient
   funds, allowance, nonce). Breaks on wallet wording changes / localization.

8. **`ensureChain` 4902 handling** relies on numeric error-code matching across
   heterogeneous wallet implementations (`packages/core/src/network.ts`).

9. **viem overload escape hatches.** `as never` / `as Parameters<...>` casts in
   `deploy.ts`, `data.ts`, and `hooks.ts` (`useContract`, `useSendTransaction`)
   drop type-safety at those call sites to satisfy viem generics.

10. **Web3Auth SDK is structurally typed**, not using the real SDK types — a
    version bump in `@web3auth/modal` could silently break the adapter with no
    type error.

## Housekeeping

11. **Stale build artifacts.** `.turbo/turbo-test.log` shows 0.1.2/0.1.3 while
    packages are at 0.1.4 — harmless cache drift.

12. **`data-api.ts` past 404 bug** (chain-object vs id) is only documented in a
    comment; worth a regression test given the API surface evolved.

13. **Version constant only correct in built artifacts.** `VERSION` is injected
    at build time; raw `tsc`/`vitest` yields `"0.0.0-dev"`. Expected, but note
    it when reading values in dev.
