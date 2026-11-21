# Browser end-to-end tests

Playwright drives Chromium through the website and through a scaffolded app, the way a
visitor would. `.github/workflows/e2e-browser.yml` runs them; `../playwright.config.ts`
picks the suite (`AVAKIT_E2E_SUITE`) and starts the server.

| Suite | What it covers | When CI runs it |
| --- | --- | --- |
| `site` (default) | `/new`: temporary wallet, faucet, deploy, mint, checked on-chain (`new.spec.ts`). Every key route loads with no console error, uncaught error or CSP violation, and an unknown path gets a clean 404 (`routes.spec.ts`). | Every pull request and push to `main`, and by hand |
| `template` | A scaffolded `nft-mint` app: temporary wallet, deploy, mint, checked on-chain; the social login option starts Web3Auth with the app's client ID (`nft-mint-template.spec.ts`). | Every pull request and push to `main`, and by hand |
| `fuji` | `/new` on the real Fuji testnet with AvaKit's hosted faucet (`new.fuji.spec.ts`, tag `@fuji`). One drip and two transactions per run, never retried. | Daily, and by hand unless started with `live=false` |
| `template` with `AVAKIT_E2E_EXTERNAL=1` | The tests tagged `@external`: the social login against Web3Auth's real servers. Nobody signs in. | Daily, and by hand unless started with `live=false` |

## In CI

A scheduled failure of `fuji` or `external` opens an issue labelled `e2e-browser-failure`,
or comments on the one already open. The label is this workflow's own, so the reports of
other workflows (e2e-fuji.yml files under `e2e-failure`) never comment on that issue or
close it.

Started by hand with `live=false`, the workflow runs `site` and `template` only, and spends
no faucet drip. That is also the only way these two checks can report on the version PR:
a workflow opens that PR with `GITHUB_TOKEN`, so its own pull_request runs wait for someone
to approve them, and release.yml's version-ci job starts ci.yml on its branch instead. Make
`site` and `template` required checks on `main` only once that job also runs:

```sh
gh workflow run e2e-browser.yml --repo "$GITHUB_REPOSITORY" --ref "$BRANCH" -f live=false
```

## Nothing the browser asks for leaves the machine

The `site` and `template` suites run against a local chain. Each test starts its own
[anvil](https://getfoundry.sh) with Fuji's chain id (43113), and `support/network.ts`
answers, for the browser:

- Fuji's JSON-RPC endpoint, by forwarding the call to anvil, so what the page signs for
  Fuji is valid there and the test can read the result back with viem;
- the faucet, with a stand-in that behaves like `services/faucet` (one drip per address,
  Fuji only) and funds the wallet with `anvil_setBalance`;
- the Draco decoder `<model-viewer>` loads from www.gstatic.com on `/avatar`, from the
  identical copy three.js ships.

Any other request the browser makes outside the app is blocked and fails the test, which
names it. When the site starts using a new third-party host, that is where to account for it
(and in the Content Security Policy).

The Next.js server is not routed, only the browser: the server-rendered `/stats` page may
still read npm and GitHub while the tests run (each request gives up after 5 s, and the page
then says it couldn't reach that source).

## Running them

You need Foundry's `anvil` on `PATH` and Playwright's Chromium
(`pnpm --filter @avakit/web exec playwright install chromium`).

```sh
# site: build with the faucet URL avakit.dev uses, then test
NEXT_PUBLIC_AVAKIT_FAUCET_URL=https://avakit-faucet.avakit.workers.dev/fund \
  pnpm --filter @avakit/web build
pnpm --filter @avakit/web test:e2e

# template: build the packages, scaffold and build nft-mint, then test it
pnpm --filter @avakit/core --filter @avakit/react --filter create-avalanche-app build
bash scripts/smoke-template.sh nft-mint /tmp/avakit-e2e
AVAKIT_E2E_SUITE=template AVAKIT_E2E_TEMPLATE_DIR=/tmp/avakit-e2e/smoke-nft-mint \
  pnpm --filter @avakit/web test:e2e
```

The site bakes `NEXT_PUBLIC_AVAKIT_FAUCET_URL` into `/new` at build time and the tests
answer that same URL, so build and test with the same value. The servers run on ports
3217 (site) and 3218 (template); `AVAKIT_E2E_SITE_PORT` and `AVAKIT_E2E_TEMPLATE_PORT`
move them. A run never reuses a server it did not start.

`AVAKIT_E2E_SUITE=fuji` spends a real faucet drip: leave it to the scheduled workflow.
