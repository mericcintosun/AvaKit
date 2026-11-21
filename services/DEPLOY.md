# Deploying the Workers

`services/faucet` and `services/telemetry` are deployed by
[`.github/workflows/deploy-workers.yml`](../.github/workflows/deploy-workers.yml),
not from a maintainer's machine. Each deploy is a commit on `main`, approved by
a maintainer, and the running Worker names that commit.

## How a deploy goes

1. A push to `main` that changes a Worker's code or config starts the workflow.
   It deploys only the Worker whose files changed; a change to Markdown alone
   deploys nothing. **Actions → Deploy · Cloudflare Workers → Run workflow**
   deploys one or both by hand, from `main`.
2. Each Worker's tests run first, in a job with no environment and no secret:
   `npm ci --ignore-scripts` from the Worker's own `package-lock.json`, then
   `npm test`. If any Worker's tests fail, nothing is deployed; dispatch the
   other Worker by hand if it cannot wait for the fix.
3. Then the deploy job waits in the `cloudflare-workers` environment until a
   maintainer approves it (**Review deployments** on the run), so what you
   approve has already passed its tests.
4. It checks that both secrets are set, installs the Worker again from its
   lockfile with install scripts off and nothing restored from a cache, runs no
   tests, and deploys with the wrangler that lockfile pins:

   ```bash
   wrangler deploy --var GIT_SHA:<commit> --tag <commit> --message "Deployed from <commit> by <run URL>"
   ```

   The token reaches that step alone. The step that checks the secrets only
   learns whether each one is set.
5. It asks the Worker's `GET /health` until it answers `"version": "<commit>"`,
   and fails if that does not happen within two minutes. A failed check leaves
   the new version live; see [Rolling back](#rolling-back).

The commit is in three places afterwards: `version` in `GET /health`, the tag
and the message of the Worker version (**Workers → the Worker → Deployments**,
or `npx wrangler deployments list`), and the workflow run.

A deploy never reads, sets or deletes a Worker secret. Plain-text variables are
the ones in `wrangler.toml`: a deploy removes any that were added in the
dashboard, which is why the faucet's kill switch is a secret.

## Setting it up (once)

The `cloudflare-workers` environment exists, with a required reviewer and only
`main` allowed to deploy. It needs two secrets.

### The API token

In the Cloudflare dashboard: **My Profile → API Tokens → Create Token →
Custom token**.

- **Permissions**
  - Account · **Workers Scripts** · **Edit**: uploads the Worker, applies its
    Durable Object migrations (there is no separate Durable Object permission)
    and keeps its `workers.dev` route.
  - Account · **Account Settings** · **Read**: lets wrangler read the account
    it deploys to.
- **Account Resources**: Include · the one account that runs the Workers.
- **Zone Resources**: none. Both Workers answer on `workers.dev` and have no
  routes on a zone.
- **TTL**: optional. A token that expires has to be replaced here before it
  does, or the next deploy fails when Cloudflare refuses it at the deploy
  step. (The credential check only sees that a secret is set, not whether it
  still works.)

Nothing else: no KV, R2, D1, Pages, Workers Tail, zone or user permissions.
If a first deploy fails with an authentication error, add the one permission
the error names instead of widening the token to the "Edit Cloudflare Workers"
template.

The account id is on the account's **Workers & Pages** overview page, or in
`npx wrangler whoami`.

### The secrets

**Settings → Environments → cloudflare-workers → Environment secrets → Add
environment secret**, twice:

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | The token above |
| `CLOUDFLARE_ACCOUNT_ID` | The account id |

Or with the GitHub CLI, which asks for the value so it stays out of your shell
history:

```bash
gh secret set CLOUDFLARE_API_TOKEN --env cloudflare-workers --repo mericcintosun/AvaKit
gh secret set CLOUDFLARE_ACCOUNT_ID --env cloudflare-workers --repo mericcintosun/AvaKit
```

Environment secrets reach only the jobs that name the environment, and those
only start once a reviewer approves them. Without the secrets, the deploy job
stops at its credential check and names the one that is missing.

## Deploying by hand

When the workflow cannot run, deploy from the Worker's directory with the
locked wrangler, and keep the link to the commit:

```bash
cd services/faucet            # or services/telemetry
npm ci
npx wrangler login
npx wrangler deploy --var "GIT_SHA:$(git rev-parse HEAD)" --tag "$(git rev-parse HEAD)"
```

Deploy only a commit that is on `main`. A Worker deployed without
`--var GIT_SHA:…` answers `"version": "dev"`, and the monitor reports it as
deployed by hand.

## Rolling back

A deploy whose `/health` check fails leaves the new version live, and so does
one that passes and then misbehaves. To put an earlier version back at once,
from the Worker's directory:

```bash
cd services/faucet            # or services/telemetry
npx wrangler deployments list # the last ten, newest at the bottom, each version with its commit as Tag
npx wrangler rollback <version-id> --message "Back to <commit>: <why>"
```

- **Name the version.** Without an id wrangler picks the deployment before the
  current one, and every `wrangler secret put` or `secret delete` is a
  deployment of its own, so that may be the same code from before a secret
  changed: the faucet as it was just before it was paused, say.
- **Secrets go back with the version.** If any secret changed since that
  version was live, wrangler names it and asks before going on, because the
  version runs with the secrets it was deployed with. Confirming undoes those
  changes, a `FAUCET_PAUSED` set since then among them.
- **Stored data stays as it is.** A rollback changes the code, not what the
  Durable Objects hold. The faucet's `drips` table keeps the `lane` column the
  daily budgets added, and the code from before them still works with it: its
  INSERT names its own columns, so `lane` takes its default, `'unverified'`.
  `test/upgrade.test.mjs` runs that older code on an upgraded table in workerd.
- **The faucet's code from before the daily budgets has no budgets and no kill
  switch.** Rolled back that far, only the per-address and per-client limits
  protect it.
- `GET /health` then names the commit of the version you rolled back to, or no
  version at all for one deployed before this workflow, and the monitor says
  so.
- While an older version is live, `wrangler secret put` fails, because the
  newest version is not the one deployed (wrangler's error says so), and the
  kill switch is set that way. Fix forward soon: revert the bad commit on
  `main` through a pull request, and this workflow deploys the result after
  approval.

## Watching them

[`.github/workflows/monitor.yml`](../.github/workflows/monitor.yml) asks
avakit.dev, the faucet's `/health` and the collector's `/health` and `/stats`
every six hours, and keeps one issue labelled `monitor` open while anything
fails. That issue is the alert: it notifies whoever watches the repository
when it opens, when what fails changes and when it closes. The run itself stays
green once the issue is up to date, and turns red only when the issue cannot be
written. `node scripts/monitor.mjs --dry-run` runs the same checks from any
machine.

GitHub switches a scheduled workflow off in a public repository after 60 days
without activity in it. If that happens, **Actions → Monitor · site and Workers
→ Enable workflow** switches it back on.
