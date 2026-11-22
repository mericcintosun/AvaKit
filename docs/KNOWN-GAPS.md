# AvaKit: known gaps

The gaps that are open on 2026-11-22, after that day's release and the Workers' deploy,
each checked that day against the code and the repository's settings. Severity: **High**
weakens something AvaKit claims or that users rely on today, **Medium** is a limit a user
should know about, **Low** is debt with a workaround. When a gap closes, delete its entry in
the same change. Add one only with evidence a reader can check.

Earlier snapshots, with the old item numbers (1–13, A1–H1) and every review pass, are in git
history: `git show 8e2ed22:docs/KNOWN-GAPS.md`. The numbering of 2026-11-21 is at
`git show a1c4f09:docs/KNOWN-GAPS.md`.

## Owner steps

Steps that only the owner can take, on GitHub, npmjs.com or Cloudflare, or outside them.

Already in place: Dependabot alerts and security updates; private vulnerability reporting,
secret scanning and push protection; a default Actions token that is read-only, with the
setting "Allow GitHub Actions to create and approve pull requests" on, which
changesets/action needs to open the version PR (it was turned back on on 2026-11-22, after
Release run 45011571752 of df7b974 failed with "GitHub Actions is not permitted to create or
approve pull requests"); the `npm-publish` and `cloudflare-workers` environments, each with
the maintainer as its required reviewer and `main` as its only deployment branch, the second
one holding `CLOUDFLARE_ACCOUNT_ID` and a scoped `CLOUDFLARE_API_TOKEN`; Trusted Publishers
on npmjs.com that name the `npm-publish` environment, for all five packages; and a ruleset
on `main` that requires a pull request and three checks from GitHub Actions, blocks force
pushes and deletion, and has no bypass actors. The three checks are `CI passed`, the last
job of `.github/workflows/ci.yml`, which on a pull request fails unless every other job
succeeded, and `Site · /new on anvil · key routes` and `Template · nft-mint on anvil`, two
jobs of `.github/workflows/e2e-browser.yml`. Neither environment lets administrators bypass
its rules, and the Actions settings require every action to be pinned to a full-length
commit SHA. The faucet and the telemetry collector were deployed through
`.github/workflows/deploy-workers.yml` on 2026-11-22, and their `GET /health` reports the
deployed commit.

1. **Turnstile is not required on the hosted faucet.** *Medium.* The faucet Worker can
   require a token from avakit.dev (`TURNSTILE_ORIGINS`) and keeps verified and unverified
   drips in separate daily budgets, and the hosted faucet has run that code since its deploy
   of 2026-11-22. But `TURNSTILE_SECRET` is not set, and setting it now would refuse every
   drip /new asks for, because avakit.dev/new renders no Turnstile widget yet. So every drip
   draws on the unverified budget of 50 a day, which one script can spend for the whole
   day.
   - Evidence: `curl -H 'Origin: https://avakit.dev' https://avakit-faucet.avakit.workers.dev/health`
     answers `"turnstile": false`; `services/faucet/README.md`, "Turnstile";
     `services/faucet/wrangler.toml:44`.
   - Closes when: /new renders the widget and sends its token, and the site's CSP allows
     Turnstile's script and frame (`challenges.cloudflare.com`; `default-src 'self'` blocks
     the frame today), which are code changes; then the owner raises
     `FAUCET_LOW_BALANCE_AVAX` to 3 and sets the secret, in the order the faucet README
     gives. This is required before the USDC drip of deliverable D2
     (`services/faucet/PROTECTION.md`).
2. **`token-bridge` ships code under the Ava Labs Ecosystem License.** *Medium.* The
   template bundles the bytecode of `ERC20TokenHome`, `ERC20TokenRemote` and
   `TeleporterRegistry`, compiled from `ava-labs/icm-contracts` v1.0.9, which is under the
   Ava Labs Ecosystem License v1.1, not MIT. That license asks to be included and displayed,
   without modification, with all uses of the software. The repository does not vendor the
   source, but `create-avalanche-app` (which `@avakit/mcp` installs) ships the bytecode in
   every scaffolded `token-bridge` app, and no copy of that license ships with it. The owner
   will check with a lawyer or with Ava Labs what this asks of AvaKit. Nothing in the code
   changes until then.
   - Evidence:
     `packages/create-avalanche-app/templates/token-bridge/lib/ictt-artifacts.json`;
     `contracts-ci/README.md`, "Upstream contracts"; the `LICENSE` of
     `ava-labs/icm-contracts` at `v1.0.9`.
   - Closes when: the owner has that answer and the repository does what it asks.
3. **Each release waits on the owner.** *Low.* By design. changesets/action opens the
   "chore: version packages" pull request from `changeset-release/main`, and for each
   release the owner:
   - clicks **Approve workflows to run** on that pull request, again after every update of
     it. GitHub holds the `pull_request` runs that `GITHUB_TOKEN`'s updates of that PR start
     until someone with write access approves them: its CI, browser tests, CodeQL and secret
     scan start only then. A run started by hand with `workflow_dispatch` does not stand in
     for them, because GitHub does not count a dispatched run's checks for a pull request's
     required checks;
   - merges the PR once `CI passed`, `Site · /new on anvil · key routes` and
     `Template · nft-mint on anvil` are green, which the ruleset requires;
   - approves the `npm-publish` deployment of the Release run that the merge starts.
   - Evidence: `RELEASING.md`, "The release flow" and "The version PR's checks"; the
     `version` job of `.github/workflows/release.yml`; the runs 44558954539 and
     44565792970, which nobody approved and which ended with no jobs; the release of
     2026-11-22 (pull request #35, Release run 45056347905), which took these three steps.
   - Closes when: it does not, by design: the merge and the publish approval stay with a
     person. The approval clicks can go, if the `version` job opens and updates the PR with
     a GitHub App token instead: the PR's runs then start without the click (`RELEASING.md`
     has the steps).

## Product

4. **Three templates and Studio's Avalanche CLI views are experimental.** *Medium.*
   `icm-messenger`, `l1-launch` and `token-bridge` start their devnets with Avalanche CLI.
   Studio's Devnet and Launch on Fuji views run the CLI, and its Interchain view works on the
   local L1s the CLI set up. Ava Labs put Avalanche CLI in maintenance mode in December 2025
   and removed it from the Avalanche documentation on 2026-10-06 in favour of Platform CLI.
   The templates and the views were last proven end to end in July 2026 (Avalanche CLI
   1.9.6). Since then CI has built the
   templates without running their devnet scripts, and unit tests have covered Studio with a
   stand-in for the CLI. Studio's Fuji launch also relies on avalanche-cli skipping its "fund
   relayer?" prompt when stdin is closed. `create-avalanche-app` 0.5.0 and `@avakit/studio`
   0.1.15 label them experimental; 0.4.3 and 0.1.14 do not.
   - Evidence: `"status": "experimental"` at line 8 of the three templates' `manifest.json`;
     `packages/studio/README.md`, "Experimental: the Avalanche CLI views";
     `packages/studio/src/fuji.ts:242-244`.
   - Closes when: they run on the supported toolchain and are proven end to end on a live
     network again.
5. **eERC proofs still use the circuits from before upstream's fixes.** *Medium.*
   `eerc-token` is pinned to `ava-labs/EncryptedERC` at `8dc98cd4`, upstream's security fixes
   of 2026-08-31, so `npm run deploy:eerc` and the shared Fuji instance have the contract
   fixes. Upstream has published no circuit files built from the fixed circuits. Proofs are
   still made with the earlier ones, which let a sender attach an extra hidden value or make
   their own amount readable. Neither moves anyone's tokens. Apps scaffolded with
   `create-avalanche-app` 0.5.0 get this pin; 0.4.3 and earlier pinned `c7eb0e09`.
   - Evidence: `packages/create-avalanche-app/templates/eerc-token/README.md`, "Pinned
     version and status"; `contracts-ci/scripts/eerc-pin.mjs`.
   - Closes when: upstream publishes circuit files and production verifiers from a new
     ceremony. Then move `CIRCUIT_COMMIT` and `COMMIT` together, and
     `node contracts-ci/scripts/eerc-pin.mjs --circuits` passes.
6. **The `eerc-token` template keeps one RPC endpoint.** *Medium.* From `@avakit/core`
   0.2.3, a chain's reads and the temporary wallet move on to the chain's next RPC endpoint
   when one fails a request (no answer, a timeout, an HTTP error, a node that says it cannot
   serve it now): PublicNode after Ava Labs' API on Fuji and C-Chain. avakit.dev uses 0.2.3,
   and its Content-Security-Policy allows both Fuji endpoints. The `eerc-token` template's
   wagmi transport still sends to `rpcUrl` alone, so that app stops when Ava Labs' API does.
   (Core, MetaMask and social login wallets send through their own RPC by design.)
   - Evidence: `packages/create-avalanche-app/templates/eerc-token/app/providers.tsx:133`;
     `packages/core/src/chains.ts` (`rpcUrls`).
   - Closes when: `eerc-token` builds its wagmi transport with `getRpcTransport`.
7. **The MCP write limits hold per call only.** *Medium.* From `@avakit/mcp` 0.3.0,
   `write_contract` calls only the contracts the server deployed in its session or that
   `AVAKIT_WRITE_ALLOWLIST` lists, and one call sends at most `AVAKIT_MAX_VALUE` AVAX. There
   is no daily or session cap, no list of allowed functions, no gas cap and no confirmation
   by a person. A contract the server deployed can pass on the calls and the AVAX it
   receives.
   - Evidence: `packages/mcp/src/limits.ts:30-33`; `packages/mcp/README.md`, "What they do
     not do".
   - Closes when: the policy layer of deliverable D1 in `docs/team1/milestone.md` ships:
     caps per call, session and day, allowlists of methods, a gas cap, human confirmation
     above a threshold, and a hash-chained audit log.

## Validation

8. **One maintainer.** *High.* One person reviews and releases, and runs the site, the
   faucet and the telemetry collector. The bus factor is 1.
   - Evidence: `MAINTAINERS.md`; `.github/CODEOWNERS`.
   - Closes when: a second maintainer is added the way `MAINTAINERS.md` describes.
9. **No outside user is validated.** *High.* Nobody outside the project has reported a
    first run. The public counter shows 10 successful anonymous scaffolds since 2026-07-15,
    none in the last 30 days, and none of them is a validated user.
    - Evidence: `gh issue list --repo mericcintosun/AvaKit --state all` was empty on
      2026-11-22; https://avakit.dev/stats, whose numbers come from
      `https://avakit-telemetry.avakit.workers.dev/stats` (`scaffolds.succeeded` 10,
      `scaffolds.last30d` 0).
    - Closes when: builders outside the project report runs through the first-run form
      (`.github/ISSUE_TEMPLATE/first-run-report.yml`), with public transaction links.
10. **The browser tests cover one template, and nobody signs in.** *Low.* `apps/web/e2e`
    drives avakit.dev/new and a scaffolded `nft-mint` app on a local chain on every pull
    request, and /new on Fuji daily. The other seven templates are built in CI, not clicked
    through. The social login test stops at Web3Auth's sign-in page.
    - Evidence: `apps/web/e2e/README.md`; `.github/workflows/e2e-browser.yml`.
    - Closes when: the other Fuji templates have specs, and a Google sign-in that ends in a
      Fuji transaction is checked (by hand before a demo, until it can be automated).
11. **Native Windows is barely exercised.** *Low.* One leg of the daily Fuji run
    (windows-latest, Node.js 24) scaffolds `nft-mint` through the MCP server and builds it.
    Nothing goes further, and the three devnet templates' setup scripts are bash (WSL2).
    - Evidence: the matrix in `.github/workflows/e2e-fuji.yml`; the `scripts/*.sh` of
      `icm-messenger`, `l1-launch` and `token-bridge`.
    - Closes when: a person runs the first-run paths on Windows and reports it.
12. **Scheduled runs start hours late.** *Low.* GitHub started the daily Fuji run (cron 05:23
    UTC) at 14:10 UTC on 2026-11-20, at 13:35 UTC on 2026-11-21 and at 13:27 UTC on
    2026-11-22. The daily runs and the six-hourly monitor therefore report within hours, not
    minutes.
    - Evidence: `gh run list --repo mericcintosun/AvaKit --workflow e2e-fuji.yml`;
      `.github/workflows/e2e-fuji.yml:53-59`, "When the schedule fires".
    - Closes when: nothing in the repository can close it. Use an outside uptime check if
      minutes matter.

## Dependencies

13. **Scaffolded apps carry an npm 10 workaround.** *Medium.* `@web3auth/modal` lists vitest
    among its runtime dependencies, and the peer dependencies that brings in make npm 10, the
    npm of Node.js 22, crash with "Cannot read properties of null (reading 'edgesOut')".
    Every template therefore ships an `.npmrc` with `legacy-peer-deps=true`, which also stops
    npm from checking the app's other peer dependencies.
    - Evidence: line 7 of every template's `npmrc`;
      `.github/workflows/web3auth-npm10-check.yml`, which each Monday scaffolds every
      template, takes the workaround out, moves `@web3auth/modal` to its latest release and
      installs the app with npm 10, and opens an issue labelled `web3auth-workaround` once
      every install passes.
    - Closes when: that issue opens. Follow its checklist, which removes the templates'
      `npmrc`, this entry and the workflow.
14. **`pnpm audit` reports three advisories below high.** *Low.* `uuid` (moderate,
    GHSA-w5hq-g745-h8pq) and `elliptic` (low, GHSA-848j-6mx2-7j84, no patched release) come
    in through `@web3auth/modal`, which every scaffolded app installs. `esbuild` (low,
    GHSA-g7r4-m6w7-qqqr, its dev server on Windows) comes in through `tsup`, at build time
    only. CI fails only on high or critical. The Workers' lockfiles have none.
    - Evidence: `pnpm audit`; `npm audit` in `services/faucet` and `services/telemetry`.
    - Closes when: Web3Auth's dependencies move to patched versions, and tsup to esbuild
      0.28.1 or later.
15. **Major upgrades are pending.** *Low.* The repository is on TypeScript 6, Vitest 4,
    Vite 7 (Studio's UI), tsup 8, Ink 7, framer-motion 12 (the website) and wagmi 2
    (`eerc-token`, which the eERC SDK holds on 2.x). On 2026-11-22 npm had TypeScript 7,
    Vitest 5, Vite 8, tsup 9, Ink 8, framer-motion 14 and wagmi 3. None of them is in the
    repository yet.
    - Evidence: the catalog in `pnpm-workspace.yaml` and the packages' `package.json`;
      `npm view <package> version`.
    - Closes when: each one is tried in its own pull request (Dependabot opens one per
      major for the workspace packages; it is not pointed at the templates, so wagmi in
      `eerc-token` is bumped by hand once the eERC SDK allows wagmi 3).

## Website

16. **Every page is rendered on request.** *Low.* The layout reads the nonce that `proxy.ts`
    makes for each response, so no page under `/[locale]` is prerendered: `next build` lists
    every one of them as dynamic (ƒ).
    - Evidence: `apps/web/app/[locale]/layout.tsx:133`; the route table of
      `pnpm --filter @avakit/web build`.
    - Closes when: accepted as the cost of a nonce-based policy, since Next.js adds the nonce
      to its own scripts only while it renders a request. Revisit if the site needs static
      caching.
17. **The site chrome stays English under `/tr`.** *Low.* The landing and templates pages
    are translated. The footer's link labels and the command menu stay English, and the
    other pages are English by design. The next-intl message files are empty (`{}`), and no
    component reads them.
    - Evidence: `apps/web/components/site-footer.tsx:9-35`; `apps/web/messages/en.json` and
      `tr.json`.
    - Closes when: the chrome is translated through `lib/content.ts`, and the unused
      next-intl message layer is removed or used.

## Code

Low-severity debt, each checked in the code on 2026-11-22.

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
