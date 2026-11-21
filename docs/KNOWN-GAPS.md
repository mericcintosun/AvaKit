# AvaKit: known gaps

The gaps that are open on 2026-11-21, after the audit fixes, each checked that day against
the code and the repository's settings. Severity: **High** weakens something AvaKit claims
or that users rely on today, **Medium** is a limit a user should know about, **Low** is debt
with a workaround. When a gap closes, delete its entry in the same change. Add one only with
evidence a reader can check.

Earlier snapshots, with the old item numbers (1–13, A1–H1) and every review pass, are in git
history: `git show 8e2ed22:docs/KNOWN-GAPS.md`.

## Owner steps

Settings that only the owner can change. No code change is needed.

1. **The hardened faucet and the collector are not deployed.** *High.* The daily budgets,
   the kill switch and the version in `GET /health` are in `services/`, but the hosted
   Workers still run their 2026-11-19 versions. Deploys now go through GitHub Actions, and
   the `cloudflare-workers` environment has no Cloudflare secrets yet.
   - Evidence: `gh api repos/mericcintosun/AvaKit/environments/cloudflare-workers/secrets`
     lists none. `node scripts/monitor.mjs --dry-run` fails both Workers: their `/health`
     "does not report its version".
   - Closes when: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are added
     (`services/DEPLOY.md`) and a run of *Deploy · Cloudflare Workers* is approved. The
     monitor then passes.
2. **`main` requires no check.** *Medium.* `ci.yml` ends in one `CI passed` job for a
   ruleset to require. But `main` has no ruleset, and its branch protection requires no
   status check and allows force pushes.
   - Evidence: `gh api repos/mericcintosun/AvaKit/rules/branches/main` returns `[]`.
     `gh api repos/mericcintosun/AvaKit/branches/main/protection` shows `"contexts":[]` and
     `"allow_force_pushes":{"enabled":true}`. The job: `.github/workflows/ci.yml:351`.
   - Closes when: a ruleset on `main` requires `CI passed` and blocks force pushes.
3. **npm's side of the publish approval is not confirmed.** *Medium.* In `release.yml` the
   `publish` job is the only job with `id-token: write`, and it waits in the `npm-publish`
   environment for the maintainer's approval (`.github/workflows/release.yml:263-266`).
   Whether each package's Trusted Publisher on npmjs.com also names that environment cannot
   be read from the repository. Until it does, npm accepts the OIDC token of any job in
   `release.yml` that is given one.
   - Evidence: npmjs.com, each package's settings, "Trusted Publisher".
   - Closes when: all five packages' Trusted Publishers name `release.yml` and the
     `npm-publish` environment.
4. **The version PR's other checks wait for a click.** *Low.* Changesets opens the version
   PR with `GITHUB_TOKEN`, so GitHub holds the PR's own `pull_request` runs until someone
   with write access clicks **Approve workflows to run**. The `version-ci` job dispatches
   `ci.yml`, so the PR gets `CI passed` without the click. The browser tests, CodeQL and the
   secret scan run on it only after the click.
   - Evidence: `.github/workflows/release.yml:230-246`; `RELEASING.md`, "The version PR's
     checks"; the runs 44558954539 and 44565792970.
   - Closes when: the owner approves those runs on each version PR, or opens the PR with a
     GitHub App token (`RELEASING.md` has the steps).

## Product

5. **Three templates and Studio's devnet views are experimental.** *Medium.* `icm-messenger`,
   `l1-launch`, `token-bridge` and Studio's Devnet, Launch on Fuji and Interchain views drive
   Avalanche CLI. Ava Labs put it in maintenance mode in December 2025 and removed it from
   the Avalanche documentation on 2026-10-06 in favour of Platform CLI. They were last proven
   end to end in July 2026 (Avalanche CLI 1.9.6). Since then CI has built the templates
   without running their devnet scripts, and unit tests have covered Studio with a stand-in
   for the CLI. Studio's Fuji launch also relies on avalanche-cli skipping its "fund
   relayer?" prompt when stdin is closed.
   - Evidence: `"status": "experimental"` at line 8 of the three templates' `manifest.json`;
     `packages/studio/README.md`, "Experimental: the Avalanche CLI views";
     `packages/studio/src/fuji.ts:242-244`.
   - Closes when: they run on the supported toolchain and are proven end to end on a live
     network again.
6. **eERC proofs still use the circuits from before upstream's fixes.** *Medium.*
   `eerc-token` is pinned to `ava-labs/EncryptedERC` at `8dc98cd4`, upstream's security fixes
   of 2026-08-31, so `npm run deploy:eerc` and the shared Fuji instance have the contract
   fixes. Upstream has published no circuit files built from the fixed circuits. Proofs are
   still made with the earlier ones, which let a sender attach an extra hidden value or make
   their own amount readable. Neither moves anyone's tokens. Scaffolded apps get the new pin
   with the next `create-avalanche-app` release: 0.4.3 is still on `c7eb0e09`.
   - Evidence: `packages/create-avalanche-app/templates/eerc-token/README.md`, "Pinned
     version and status"; `contracts-ci/scripts/eerc-pin.mjs`.
   - Closes when: upstream publishes circuit files and production verifiers from a new
     ceremony. Then move `CIRCUIT_COMMIT` and `COMMIT` together, and
     `node contracts-ci/scripts/eerc-pin.mjs --circuits` passes.
7. **The RPC fallback is not released and does not reach the site.** *Medium.* On `main`,
   `@avakit/core` moves on to a chain's next RPC endpoint: PublicNode after Ava Labs' API on
   Fuji and C-Chain. Version 0.2.2 on npm has one endpoint per chain. avakit.dev installs
   `@avakit/core` 0.2.2 from npm, so it gets the fallback only after the next release and a
   bump in `apps/web`, and its Content-Security-Policy allows only the primary Fuji RPC. The
   `eerc-token` template's wagmi transport also keeps one endpoint. (Core, MetaMask and social
   login wallets send through their own RPC by design.)
   - Evidence: `packages/core/src/chains.ts` (`rpcUrls`); `apps/web/package.json:18` and
     `pnpm-lock.yaml` (`@avakit/core` 0.2.2); `apps/web/lib/csp.ts:91-97`;
     `packages/create-avalanche-app/templates/eerc-token/app/providers.tsx:133`.
   - Closes when: core is released; `apps/web` moves to it, and `connect-src` lists the
     origin of every `rpcEndpoints(fuji)` entry (with `apps/web/test/csp.test.mjs`);
     `eerc-token` builds its wagmi transport with `getRpcTransport`.
8. **The MCP write limits hold per call only.** *Medium.* `write_contract` calls only the
   contracts the server deployed in its session or that `AVAKIT_WRITE_ALLOWLIST` lists, and
   one call sends at most `AVAKIT_MAX_VALUE` AVAX. There is no daily or session cap, no list
   of allowed functions, no gas cap and no confirmation by a person. A contract the server
   deployed can pass on the calls and the AVAX it receives. The limits ship in the
   `@avakit/mcp` release after 0.2.1.
   - Evidence: `packages/mcp/src/limits.ts:30-33`; `packages/mcp/README.md`, "What they do
     not do".
   - Closes when: the policy layer of deliverable D1 in `docs/team1/milestone.md` ships:
     caps per call, session and day, allowlists of methods, human confirmation above a
     threshold, and a hash-chained audit log.
9. **Turnstile is not required on the hosted faucet.** *Medium.* The faucet Worker can
   require a token from avakit.dev (`TURNSTILE_ORIGINS`) and keeps verified and unverified
   drips in separate daily budgets. But `TURNSTILE_SECRET` is not set, because avakit.dev/new
   renders no widget yet. So once the budgets are deployed, every drip draws on the
   unverified budget, which one script can spend for the whole day.
   - Evidence: `curl https://avakit-faucet.avakit.workers.dev/health` answers
     `"turnstile": false`; `services/faucet/README.md`, "Turnstile";
     `services/faucet/wrangler.toml:40`.
   - Closes when: /new renders the widget and sends its token, the site's CSP allows
     Turnstile's script and frame (`challenges.cloudflare.com`; `default-src 'self'` blocks
     the frame today), and the secret is set. This is required before the USDC drip of
     deliverable D2 (`services/faucet/PROTECTION.md`).

## Validation

10. **One maintainer.** *High.* One person reviews and releases, and runs the site, the
    faucet and the telemetry collector. The bus factor is 1.
    - Evidence: `MAINTAINERS.md`; `.github/CODEOWNERS`.
    - Closes when: a second maintainer is added the way `MAINTAINERS.md` describes.
11. **No outside user is validated.** *High.* Nobody outside the project has reported a
    first run. The public counter shows 10 successful anonymous scaffolds since 2026-07-15,
    none in the last 30 days, and none of them is a validated user.
    - Evidence: `gh issue list --repo mericcintosun/AvaKit --state all` was empty on
      2026-11-21; https://avakit.dev/stats, whose numbers come from
      `https://avakit-telemetry.avakit.workers.dev/stats` (`scaffolds.succeeded` 10,
      `scaffolds.last30d` 0).
    - Closes when: builders outside the project report runs through the first-run form
      (`.github/ISSUE_TEMPLATE/first-run-report.yml`), with public transaction links.
12. **The browser tests cover one template, and nobody signs in.** *Low.* `apps/web/e2e`
    drives avakit.dev/new and a scaffolded `nft-mint` app on a local chain on every pull
    request, and /new on Fuji daily. The other seven templates are built in CI, not clicked
    through. The social login test stops at Web3Auth's sign-in page.
    - Evidence: `apps/web/e2e/README.md`; `.github/workflows/e2e-browser.yml`.
    - Closes when: the other Fuji templates have specs, and a Google sign-in that ends in a
      Fuji transaction is checked (by hand before a demo, until it can be automated).
13. **Native Windows is barely exercised.** *Low.* One leg of the daily Fuji run
    (windows-latest, Node.js 24) scaffolds `nft-mint` through the MCP server and builds it.
    Nothing goes further, and the three devnet templates' setup scripts are bash (WSL2).
    - Evidence: the matrix in `.github/workflows/e2e-fuji.yml`; the `scripts/*.sh` of
      `icm-messenger`, `l1-launch` and `token-bridge`.
    - Closes when: a person runs the first-run paths on Windows and reports it.
14. **Scheduled runs start hours late.** *Low.* GitHub started the daily Fuji run (cron 05:23
    UTC) at 14:10 UTC on 2026-11-20 and at 13:35 UTC on 2026-11-21. The daily runs and the
    six-hourly monitor therefore report within hours, not minutes.
    - Evidence: `gh run list --repo mericcintosun/AvaKit --workflow e2e-fuji.yml`;
      `.github/workflows/e2e-fuji.yml:53-59`, "When the schedule fires".
    - Closes when: nothing in the repository can close it. Use an outside uptime check if
      minutes matter.

## Dependencies

15. **Scaffolded apps carry an npm 10 workaround.** *Medium.* `@web3auth/modal` lists vitest
    among its runtime dependencies, and the peer dependencies that brings in make npm 10, the
    npm of Node.js 22, crash with "Cannot read properties of null (reading 'edgesOut')".
    Every template therefore ships an `.npmrc` with `legacy-peer-deps=true`, which also stops
    npm from checking the app's other peer dependencies.
    - Evidence: line 7 of every template's `npmrc`;
      `.github/workflows/web3auth-npm10-check.yml`, which tries a plain npm 10 install of
      every template each Monday and opens an issue labelled `web3auth-workaround` once all
      of them pass.
    - Closes when: that issue opens. Follow its checklist: drop the `.npmrc` line, this
      entry and the workflow.
16. **`pnpm audit` reports three advisories below high.** *Low.* `uuid` (moderate,
    GHSA-w5hq-g745-h8pq) and `elliptic` (low, GHSA-848j-6mx2-7j84, no patched release) come
    in through `@web3auth/modal`, which every scaffolded app installs. `esbuild` (low,
    GHSA-g7r4-m6w7-qqqr, its dev server on Windows) comes in through `tsup`, at build time
    only. CI fails only on high or critical. The Workers' lockfiles have none.
    - Evidence: `pnpm audit`; `npm audit` in `services/faucet` and `services/telemetry`.
    - Closes when: Web3Auth's dependencies move to patched versions, and tsup to esbuild
      0.28.1 or later.
17. **Major upgrades are pending.** *Low.* The repository is on TypeScript 6, Vitest 4,
    Vite 7 (Studio's UI), tsup 8, Ink 7, framer-motion 12 (the website) and wagmi 2
    (`eerc-token`, which the eERC SDK holds on 2.x). On 2026-11-21 npm had TypeScript 7,
    Vitest 5, Vite 8, tsup 9, Ink 8, framer-motion 14 and wagmi 3. None of them is in the
    repository yet.
    - Evidence: the catalog in `pnpm-workspace.yaml` and the packages' `package.json`;
      `npm view <package> version`.
    - Closes when: each one is tried in its own pull request (Dependabot opens one per
      major).

## Website

18. **Every page is rendered on request.** *Low.* The layout reads the nonce that `proxy.ts`
    makes for each response, so no page under `/[locale]` is prerendered: `next build` lists
    every one of them as dynamic (ƒ).
    - Evidence: `apps/web/app/[locale]/layout.tsx:133`; the route table of
      `pnpm --filter @avakit/web build`.
    - Closes when: accepted as the cost of a nonce-based policy, since Next.js adds the nonce
      to its own scripts only while it renders a request. Revisit if the site needs static
      caching.
19. **The site chrome stays English under `/tr`.** *Low.* The landing and templates pages
    are translated. The footer's link labels and the command menu stay English, and the
    other pages are English by design. The next-intl message files are empty (`{}`), and no
    component reads them.
    - Evidence: `apps/web/components/site-footer.tsx:9-35`; `apps/web/messages/en.json` and
      `tr.json`.
    - Closes when: the chrome is translated through `lib/content.ts`, and the unused
      next-intl message layer is removed or used.

## Code

Low-severity debt, each checked in the code on 2026-11-21.

| Gap | Evidence | Closes when |
| --- | --- | --- |
| `useContract().write` resolves at broadcast, so each template waits for the receipt itself | `packages/react/src/hooks.ts:111-124` | `write` waits for the receipt and throws on a revert |
| An injected or social login wallet is not reconnected after a reload; only `autoConnect="burner"` exists | `packages/react/src/provider.tsx:210` | the provider restores the last wallet |
| `humanizeError` also matches wallet errors by their wording | `packages/react/src/utils.ts:105` | errors are mapped by code only |
| The Web3Auth SDK is typed structurally, so an SDK change can break the adapter without a type error | `packages/core/src/adapters/web3auth.ts:59` | the adapter is type-checked against the SDK |
| `ReadContractParams` and `ChainRef` are not exported from the package entry | `packages/core/src/index.ts:42-61` | both are exported |
| `estimate_gas` and `read_chain` give AVAX as `Number(wei) / 1e18`; the wei next to it is exact | `packages/mcp/src/server.ts:324` and `:399` | `formatEther`, as `wallet_status` does |
| `token-bridge` clears its "in flight" banner after a fixed 12 seconds | `packages/create-avalanche-app/templates/token-bridge/components/demo.tsx:162` | it waits for the remote balance to change |
| `docs/04-adr.md` still lists an AvaCloud WaaS adapter, which was never built | `docs/04-adr.md:14` | the ADR is amended |
| The animation rule is checked in the templates only: Studio's UI and the website run CSS keyframe animations of their own | `packages/studio/ui/src/components/BootSplash.tsx:109`, `packages/studio/ui/src/index.css:84`, `apps/web/app/[locale]/new/live-demo.tsx:155` | they move to Framer Motion, or `docs/11-conventions.md` names them |
| The NFT template's contract keeps AvaKit's name, symbol and palette in a contract users deploy as theirs (an owner decision) | `packages/create-avalanche-app/templates/nft-mint/contracts/src/AvaKitNFT.sol:22-23` | the owner decides |
| The template contracts are demos: anyone can call `mint` | `packages/create-avalanche-app/templates/erc20-token/contracts/src/AvaKitToken.sol:20`, `packages/create-avalanche-app/templates/nft-mint/contracts/src/AvaKitNFT.sol:65` | by design; say so before anyone copies them to production |
| The ASCII banner is copied, byte for byte, in three packages | `packages/{create-avalanche-app,mcp,studio}/src/banner.ts` | one shared source |
