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
2. The deploy job waits in the `cloudflare-workers` environment until a
   maintainer approves it (**Review deployments** on the run).
3. It installs the Worker from its own `package-lock.json` with install scripts
   off, runs its tests, and deploys with the wrangler that lockfile pins:

   ```bash
   wrangler deploy --var GIT_SHA:<commit> --tag <commit> --message "Deployed from <commit> by <run URL>"
   ```

4. It asks the Worker's `GET /health` until it answers `"version": "<commit>"`,
   and fails if that does not happen within two minutes.

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
  does, or the next deploy fails at its first step.

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
stops at its first step and names the one that is missing.

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

## Watching them

[`.github/workflows/monitor.yml`](../.github/workflows/monitor.yml) asks
avakit.dev, the faucet's `/health` and the collector's `/health` and `/stats`
every six hours, and keeps one issue labelled `monitor` open while anything
fails. `node scripts/monitor.mjs --dry-run` runs the same checks from any
machine.
