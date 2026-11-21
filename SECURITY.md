# Security Policy

AvaKit deals with wallets and on-chain deployments. This file says what it does with keys,
what stands between a user and a mainnet transaction, what protects the hosted faucet, the
website and the releases, and how to report a vulnerability.

Some protections below are on `main` but not on npm yet, or not deployed yet. Each of them
says so; a package names the last version on npm that does not have it.

## Core guarantees

- **With a real wallet, the end-user's private keys stay with the wallet provider.**
  For the social-login (Web3Auth), injected (Core/MetaMask) and Coinbase Smart Wallet
  adapters, key generation, storage, and signing live inside the wallet provider —
  AvaKit's browser code only uses a signing interface and never sees a seed phrase or
  private key.
- **AvaKit code handles a private key in two deliberate cases, both throwaway and both
  refused on every mainnet:** the temporary in-browser wallet (`burnerAdapter()`, for
  testnets and local devnets) and the MCP server's session test wallet (for the Fuji
  testnet only). Each has a section below. Neither may ever hold real value.
- **No secrets in code or logs.** Secrets — deploy keys, RPC and API keys — are read
  from environment variables and are never written to logs or tool output. (The
  Web3Auth client ID bundled in the scaffolded templates is not a secret: a client ID
  is a public identifier that reaches every browser anyway, and this demo one only
  allows localhost origins, so social login works with zero setup. Set
  `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` to use your own.)
- **Mainnet is opt-in.** Everything defaults to the Fuji testnet, and a mainnet
  transaction is refused until it is confirmed explicitly — see [Mainnet](#mainnet).

## Exception 1: the burner wallet holds a key in the browser

`burnerAdapter()` (`@avakit/core`) is the zero-setup path that lets a stranger try a
real Fuji transaction without installing a wallet. Every scaffolded template wires it
up: the five Fuji templates on Fuji, the other three on their local devnet.

- **What it is.** It calls viem's `generatePrivateKey()` **in the browser** and, by
  default, persists that key to **`localStorage` in the clear** (`avakit.burner.pk`).
  Any script running on the page can read it. There is no HSM and no enclave.
- **What limits it.** It is refused on any mainnet, in the adapter itself and again in
  `<AvaKitProvider>`, which also disconnects a burner if the app switches to a mainnet.
  A chain counts as a mainnet unless its definition says `testnet: true`, and chain id
  43114 always does. The definition's label is not trusted on its own:
  - Before the burner first sends through one of the chain's RPC endpoints, it asks that
    endpoint's node which chain it serves, and refuses unless it is the chain the
    definition names. Any node it asks that names another chain stops the send there.
  - It signs every transaction for the definition's chain id only. A node that passes the
    check and then lies still gets nothing but a signature that every other chain rejects.
  - A chain can list several endpoints (`rpcUrls`; `@avakit/core` up to 0.2.2 has one per
    chain). The burner sends each transaction through one of them: the first, in the
    chain's order, whose node has confirmed the chain. Every request of that send goes
    there, so a send never moves to another node halfway, and the burner never sends a
    transaction twice. An endpoint whose node does not answer passes the question to the
    next one; when none answers, nothing is signed. A refusal names such an endpoint by its
    place in `rpcUrls` and its origin, never by the whole URL, which can hold a password or
    an API key.

  A testnet label on a mainnet RPC therefore gets "Nothing was signed or sent" instead of
  a mainnet transaction. A template scaffolded for C-Chain does not offer the burner at
  all. `clearBurner()` deletes the key, and `persist: false` keeps it in memory only.
- **What it must never be used for.** It is a throwaway testnet identity holding a
  faucet drip, and nothing else. Never send real funds to a burner address, and never
  present a burner as a way to hold value. Treat it as a session, not a wallet.
- The other adapters are the upgrade path: a user with Core/MetaMask or social login
  gets provider-held keys, and the first guarantee above applies to them.

## Exception 2: the MCP session test wallet holds a key in memory

When `AVAKIT_DEPLOYER_KEY` is not set, `@avakit/mcp`'s `deploy_contract` and
`write_contract` sign Fuji transactions with a wallet the server creates for itself the
first time one is needed, so that an agent on a clean machine can deploy and mint
without a key being created, funded and configured first.

- **What it is.** A private key generated inside the server process with viem's
  `generatePrivateKey()`. It is never written to disk, never logged, never returned by
  a tool and never put in an error message; only its address is shown. It is gone when
  the server stops, together with whatever test AVAX was left in it.
- **What limits it.** It signs for Avalanche Fuji (chain id 43113) only, and the check
  is made at the moment of signing, so no other chain can get a signature from it. It
  never sends AVAX with a transaction: it pays for gas and nothing else, so it cannot
  forward what the faucet gave it. It is never used when `AVAKIT_DEPLOYER_KEY` is set,
  and `AVAKIT_TEST_WALLET=0` (also `false`, `off` or `no`) in the server's environment
  turns it off. Every result of a signing tool names the signer and its source
  (`session` or `env`), and `wallet_status` shows it without sending anything. Like any
  signer of the server, it is held to the [write limits](#the-mcp-servers-write-limits).
- **What it must never be used for.** Anything that has to outlive the server process,
  and anything of value. It cannot sign for a mainnet, and nothing should be sent to
  its address except test AVAX.

## Mainnet

- **`@avakit/core` and `@avakit/react`.** `deployContract()` (and `useAvaDeploy()`)
  throws `MainnetConfirmationError` for a mainnet chain unless the caller passes
  `confirmMainnet: true`. With the confirmation given, it still reads the account's
  balance first and refuses a deployment the account cannot pay for; if the balance
  cannot be read, it does not deploy. A chain definition that leaves out `testnet: true`
  is treated as a mainnet.
- **`@avakit/mcp`.** A mainnet `deploy_contract` or `write_contract` needs the user's
  own key in `AVAKIT_DEPLOYER_KEY` and **two** independent approvals: `confirm: true`
  in the tool call **and** `AVAKIT_ALLOW_MAINNET=1` in the environment the MCP server
  runs in. `confirm: true` alone is refused, on purpose: an AI agent can be talked into
  passing it by a prompt-injected instruction, but it cannot change the server's
  environment, so a malicious prompt on its own can never spend real funds. That holds
  while the agent cannot edit the server's configuration either: keep
  `AVAKIT_DEPLOYER_KEY` and `AVAKIT_ALLOW_MAINNET` in your user-level MCP client config,
  not in a project file such as `.mcp.json` or `.cursor/mcp.json`. The environment gate
  is checked again when the transaction is signed. `write_contract` does not send AVAX
  with a call on mainnet, and from the release after 0.2.1 it is held to the write limits
  there as on Fuji. Leave `AVAKIT_ALLOW_MAINNET` unset for everyday testnet work.
- **`create-avalanche-app`.** Only the `minimal` template can be scaffolded for C-Chain
  mainnet (`--chain c-chain`); the scaffolder and the MCP server's `scaffold_app`
  refuse that chain for every other template. A mainnet scaffold has no burner wallet,
  no faucet and no bundled demo Web3Auth client ID.

## The MCP server's write limits

On `main`, in the `@avakit/mcp` release after 0.2.1 (0.2.1 does not have them). An agent
can be steered by what it reads, so the two signing tools are held to two limits from the
server's environment, which a tool call cannot change:

- **Which contracts.** `write_contract` calls a contract only when this server deployed it
  with `deploy_contract`, on the same chain, since the server started, or when
  `AVAKIT_WRITE_ALLOWLIST` lists its address (`*` allows any). An address listed there may
  be called on every chain the server signs for. No address is taken from a file, because
  an agent can write files too.
- **How much AVAX.** One `deploy_contract` or `write_contract` call sends at most
  `AVAKIT_MAX_VALUE` AVAX with its transaction, 0.1 when it is not set. Only a call with
  your own key on Fuji can carry value at all.

Both are checked before the chain or the faucet is asked anything, and again when the
transaction is signed. A value that cannot be read refuses every call it governs. The
limits hold per call: there is no daily or session cap, no list of allowed functions, no
gas cap and no confirmation by a person, and a contract the server deployed can pass on
the calls and the AVAX it receives ([`docs/KNOWN-GAPS.md`](docs/KNOWN-GAPS.md)). Keep both
variables in your user-level MCP client config, like the mainnet ones. The
[`@avakit/mcp` README](packages/mcp/README.md#write-limits) has the details.

## The shared Fuji faucet

The five Fuji templates and the MCP session test wallet ask AvaKit's shared faucet
(`https://avakit-faucet.avakit.workers.dev/fund`, exported from `@avakit/core` as
`AVAKIT_FAUCET_URL`) for test AVAX, so that a first transaction can be paid for.

- **What it is.** A Cloudflare Worker ([`services/faucet`](services/faucet)) that holds
  a throwaway Fuji funding key as a Worker secret and sends a small drip of test AVAX
  to an address. It is paid for by the maintainer and meant for first runs. Client code
  sends it an address and never sees a key. It is only ever asked on Fuji, and never by
  an app on a mainnet.
- **Its limits.** Exact limits kept in a Durable Object: one drip per address per 24
  hours, and per client (an IPv4 address or an IPv6 /64) 20 drips per rolling hour, 8 in
  flight and 10 failed attempts per five minutes. One transaction is sent at a time, so
  two requests never sign the same nonce; a transaction whose answer was lost is looked up
  by hash; contract recipients and mainnet chain ids are refused, and a drip pays for at
  most 100,000 gas. This version has run the hosted faucet since 2026-11-19, with
  Turnstile off.
- **On `main`, not deployed yet.** The hosted faucet gets these with its next deploy
  (until then its `GET /health` reports no `version`). That deploy waits for an owner step:
  the Cloudflare API token that `.github/workflows/deploy-workers.yml` needs is not set yet
  ([`docs/KNOWN-GAPS.md`](docs/KNOWN-GAPS.md), "Owner steps").
  - **Daily budgets** per UTC day, over all callers together: 50 drips for requests
    without a verified Turnstile token (`FAUCET_DAILY_DRIPS`) and 100 for verified ones
    (`FAUCET_DAILY_DRIPS_VERIFIED`). Once a budget is spent, every request that draws on
    it is refused with `429 daily_limited` until 00:00 UTC. At 0.02 AVAX a drip, a drain
    takes at most 1 AVAX a day in drips while Turnstile is off.
  - **A kill switch.** The `FAUCET_PAUSED` secret makes `POST /fund` answer
    `503 faucet_paused` at once, without asking the chain.
  - **A Turnstile lane.** Once `TURNSTILE_SECRET` is set, a request from an origin in
    `TURNSTILE_ORIGINS` (`https://avakit.dev`) must carry a token. A verified token draws
    on the verified budget, and every other request on the unverified one. It stays off
    until avakit.dev/new sends a token.
  - **Watching.** `GET /health` reports the deployed commit, a low balance, the pause and
    today's use, and `.github/workflows/monitor.yml` checks it every six hours.
- **Why CORS stays open.** Scaffolded apps ask the faucet from whatever origin they run
  on, the MCP server sends no `Origin`, and a script ignores CORS anyway, so the limits
  above are the defence ([`services/faucet/PROTECTION.md`](services/faucet/PROTECTION.md)).
- **When it refuses.** It can be empty, and it can refuse. The apps and the MCP server
  then show the reason and point to the
  [official Fuji faucet](https://build.avax.network/console/primary-network/faucet),
  which needs a free Builder Hub sign-in.
- **Turning it off.** Scaffolded apps: set `NEXT_PUBLIC_AVAKIT_FAUCET_URL` to the
  `/fund` URL of your own faucet, or to `off`. MCP server: set `AVAKIT_FAUCET_URL` to
  another faucet, set `AVAKIT_TEST_WALLET=0`, or use your own key. Nothing in
  `@avakit/core` or `@avakit/react` calls a faucet unless a URL is passed to it.

## avakit.dev

`avakit.dev/new` keeps a temporary wallet whose key sits in `localStorage`, and signs Fuji
transactions with one click, so any script that runs on the site could read that key. The
site therefore sends a nonce-based Content-Security-Policy with every page
([`apps/web/lib/csp.ts`](apps/web/lib/csp.ts), set by `apps/web/proxy.ts`). The one page
sent without it is the 404 page of a path with a dot in it (`/x.php`), which `proxy.ts`
does not see; it shows what it takes from the request only escaped.

- A script runs only if it carries the nonce made for that response, or was loaded by a
  script that does (`'strict-dynamic'`). An injected `<script>` or inline event handler
  does not run, and JavaScript `eval` is refused.
- The browser may connect only to the site itself, the Fuji RPC endpoints of the
  `@avakit/core` the site is built with (0.2.2 has one), the faucet and the decoder the 3D
  models need.
- No plugins, no `<base>` or form posts pointing to another site, and no framing by
  another site.

Inline styles are allowed, because React renders `style` props as attributes; a style
cannot read `localStorage`. Every page is rendered on request, so that it carries a fresh
nonce.

## How releases are published

- **No npm token.** Neither the repository nor its environments hold an npm token. The
  five packages are published through npm trusted publishing (OIDC) by
  `.github/workflows/release.yml` only, and every version it publishes carries a
  provenance attestation that names the workflow run and the commit.
- **A person approves each publish.** The `publish` job runs in the `npm-publish`
  environment, which accepts `main` only and waits for the maintainer's approval. It is
  the only job of the workflow that can ask for an id-token, and it checks out and
  installs nothing: it publishes the tarballs the `pack` job packed, after checking each
  one against the sha256 that job recorded.
- **npm's side of that approval is an owner step.** Until each package's Trusted Publisher
  on npmjs.com names the `npm-publish` environment, npm accepts the id-token of any job of
  `release.yml` that is given `id-token: write`, and the approval is enforced by GitHub
  alone. That setting has not been made yet ([`docs/KNOWN-GAPS.md`](docs/KNOWN-GAPS.md),
  "Owner steps").
- **Nothing is published from a red tree.** `verify` first runs lint, typecheck, the
  tests, the changeset check and the MCP install smoke test on the commit it releases.
- **What this does not stop.** `pack` builds the tarballs on a runner of its own, from a
  fresh checkout installed without install scripts, and runs nothing but the packages'
  builds and `pnpm pack`; the tests and the smoke test run in `verify` and never touch
  them, and no job of the workflow restores an Actions cache. A compromised build tool
  (tsup, vite, esbuild, Turborepo) could still change what it builds. The approval and
  the provenance are what stand between it and npm. [`RELEASING.md`](RELEASING.md) has
  the steps.

## How the code is checked

- **The `main` branch.** A ruleset requires a pull request and CI's `CI passed` check
  before anything lands on `main`, and blocks force pushes and deletion, with no bypass.
  The repository's default Actions token is read-only and cannot approve pull requests.
- **CI** runs with a read-only token: lint, typecheck, build and tests on Node.js 22 and
  24, with coverage thresholds for core, react, mcp and the scaffolder. It scaffolds and
  builds every template, and rebuilds every shipped contract artifact with Foundry and
  compares it byte for byte.
- **Dependencies.** `pnpm audit` and the Workers' `npm audit` fail CI on a high or
  critical advisory, and on a pull request, dependency review fails on a new one in any
  dependency, development dependencies included. Dependabot opens weekly version updates,
  and Dependabot alerts and security updates are on.
- **CodeQL** scans the JavaScript and TypeScript code and the GitHub workflows on every
  push to `main`, every pull request and once a week.
- **Secrets.** GitHub secret scanning with push protection is on. gitleaks, a pinned and
  checksum-verified binary, scans the full history of every push and pull request, and
  every branch and tag once a week, with its default rules and a configuration
  (`.gitleaks.toml`) that the workflow first checks still reports a planted key. Values
  that are public on purpose are acknowledged in two places: `.gitleaks.toml` allows two
  published test keys (the EWOQ key and Anvil's first account) wherever they appear, and
  the digests `contracts-ci` pins, in their files only; `.gitleaksignore` acknowledges
  the demo Web3Auth client ID one finding at a time.
- **OpenSSF Scorecard** grades the repository's supply-chain practices once a week and on
  every push to `main`.
- **Browser tests** drive avakit.dev/new and a scaffolded `nft-mint` app on every pull
  request, and fail on any Content-Security-Policy violation on the site's key routes and
  its 404 page.

## Local developer tooling

Some AvaKit surfaces run on the developer's own machine and use keys locally. This is
by design and is scoped to local/testnet use:

- **The EWOQ key** (`0x56289e99…8027`) in Studio's source is Avalanche's well-known
  **public** development key, which avalanche-cli funds on every local network. It is
  never a real secret. From the Studio release after 0.1.14, Studio signs its Interchain
  transactions with it in its own process, so the key is on no command line. It signs only
  for an L1 whose RPC URL is on this machine (`localhost`, `127.0.0.0/8` or `::1`), follows
  no redirect, and refuses an RPC that answers for another chain ID than the one
  avalanche-cli recorded for that L1. Studio 0.1.14 still passes the key to `cast` on the
  command line, where other processes on the machine can read it. The templates' devnet
  scripts read the key from avalanche-cli instead of carrying it.
- **`@avakit/mcp` with your own key.** `AVAKIT_DEPLOYER_KEY` in the server's
  environment replaces the session test wallet. The key is never logged or returned,
  and an invalid value is reported without repeating it. A transaction the key cannot
  pay for is refused before anything is sent.
- **`@avakit/mcp` and the filesystem.** `scaffold_app` creates projects, and
  `artifactPath` reads contract artifacts, only inside one directory: the server's
  working directory, or the directory named by `AVAKIT_MCP_ROOT` in the server's
  environment. Containment is checked on real paths, so a symlink that points outside
  is not a way out, and a file that is not a contract artifact is refused without its
  contents being quoted. A server whose working directory is the filesystem root (as
  Claude Desktop starts it on macOS) refuses to scaffold until `AVAKIT_MCP_ROOT` names
  a directory. Like the mainnet gate, that variable cannot be set by a tool call.
- **`@avakit/studio`** runs a local control center that drives `avalanche-cli`. It is a
  tool you launch yourself from your own terminal, and is hardened accordingly: it binds
  `127.0.0.1` only, validates the `Host` header (anti-DNS-rebinding), gates every API
  call behind a per-session token injected into the served page (cross-origin pages
  cannot read it), refuses to be framed, and starts an action only from a `POST`. It
  runs external tools only via `spawn`/`execFile` with **argument arrays built from
  validated values — never a shell**. Any request-derived value that can reach an
  argument or a filesystem path (L1 name, chain id, token symbol, amount) is
  whitelist-validated first. An Interchain message must be non-empty, at most 256 bytes
  of UTF-8, and may not start with `-`; its text never reaches a command line, because
  Studio ABI-encodes the call (and, from the release after 0.1.14, signs and sends it
  itself). avalanche-cli actions run one at a time across every Studio process on the
  machine, and are owned by the Studio server, not by the browser tab. From the release
  after 0.1.14, stopping Studio stops the avalanche-cli command it started (`SIGTERM`,
  then `SIGKILL` after 5 seconds); the local network stays up on purpose, and Studio
  says how to stop it.

## Reporting a vulnerability

Please do not open a public issue, discussion, or pull request for a security
vulnerability. Report it privately instead, so a fix can be prepared before disclosure:

**[Report a vulnerability](https://github.com/mericcintosun/AvaKit/security/advisories/new)**
— GitHub's private vulnerability reporting, also reachable from the **Security** tab of
the repository (**Report a vulnerability**). All you need is a GitHub account; the
report is visible only to you and the maintainer.

It helps to include the affected package and version (or commit), what an attacker
could do, and the steps or a proof of concept that reproduce it.

The maintainer aims to acknowledge a report within three business days. AvaKit has one
maintainer, so that is an intention and not a guarantee. A disclosure timeline is
agreed with you in that advisory.

## Supported versions

AvaKit is in early (0.x) releases. Security fixes target the latest published versions
and the `main` branch until a stable release line is established.

AvaKit needs Node.js 22 or newer: Node.js 20 reached end of life in April 2026 and gets no
security fixes. Every package declares `>=22` in `engines.node` on `main`;
`create-avalanche-app` already does on npm, and the other four do from their next release.
