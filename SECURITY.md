# Security Policy

AvaKit deals with wallets and on-chain deployments. This file says what it does with
keys, what stands between a user and a mainnet transaction, and how to report a
vulnerability.

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
  43114 always does. A template scaffolded for C-Chain does not offer the burner at
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
  (`session` or `env`), and `wallet_status` shows it without sending anything.
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
  environment, so a malicious prompt on its own can never spend real funds. The
  environment gate is checked again when the transaction is signed. `write_contract`
  does not send AVAX with a call on mainnet. Leave `AVAKIT_ALLOW_MAINNET` unset for
  everyday testnet work.
- **`create-avalanche-app`.** Only the `minimal` template can be scaffolded for C-Chain
  mainnet (`--chain c-chain`); the scaffolder and the MCP server's `scaffold_app`
  refuse that chain for every other template. A mainnet scaffold has no burner wallet,
  no faucet and no bundled demo Web3Auth client ID.

## The shared Fuji faucet

The five Fuji templates and the MCP session test wallet ask AvaKit's shared faucet
(`https://avakit-faucet.avakit.workers.dev/fund`, exported from `@avakit/core` as
`AVAKIT_FAUCET_URL`) for test AVAX, so that a first transaction can be paid for.

- **What it is.** A Cloudflare Worker ([`services/faucet`](services/faucet)) that holds
  a throwaway Fuji funding key as a Worker secret and sends a small drip of test AVAX
  to an address. It is paid for by the maintainer and meant for first runs. Client code
  sends it an address and never sees a key. It is only ever asked on Fuji, and never by
  an app on a mainnet.
- **Its limits.** One drip per address per 24 hours and an hourly cap per network
  address, enforced by the Worker. It can be empty, and it can refuse. The apps and the
  MCP server then show the reason and point to the
  [official Fuji faucet](https://build.avax.network/console/primary-network/faucet),
  which needs a free Builder Hub sign-in.
- **Not deployed yet.** The Worker in this repository has abuse controls that the
  running faucet does not have yet: exact limits kept in a Durable Object (per address
  per 24 hours, per client per hour with IPv6 counted by /64, a cap on drips in flight
  per client, a cap on failed attempts), one transaction sent at a time so that two
  requests never sign the same nonce, a lookup by hash when the node's answer is lost,
  a refusal of contract recipients, and an optional Cloudflare Turnstile check. Until
  it is deployed, the hosted faucet runs the earlier version, whose rate limits are
  counted in a KV namespace and can be exceeded by parallel requests.
- **Turning it off.** Scaffolded apps: set `NEXT_PUBLIC_AVAKIT_FAUCET_URL` to the
  `/fund` URL of your own faucet, or to `off`. MCP server: set `AVAKIT_FAUCET_URL` to
  another faucet, set `AVAKIT_TEST_WALLET=0`, or use your own key. Nothing in
  `@avakit/core` or `@avakit/react` calls a faucet unless a URL is passed to it.

## Local developer tooling

Some AvaKit surfaces run on the developer's own machine and use keys locally. This is
by design and is scoped to local/testnet use:

- **The EWOQ key** (`0x56289e99…8027`) that appears in Studio's source is Avalanche's
  well-known **public** development key. It is pre-funded only on local devnets, is
  documented as local-only, and is never a real secret. Studio passes it to `cast` on
  the command line, where other processes of the same user can see it. The templates'
  devnet scripts read it from avalanche-cli instead of carrying it.
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
- **`@avakit/studio`** runs a local control center that can drive `avalanche-cli`,
  `forge`, and `cast`. It is a tool you launch yourself from your own terminal, and is
  hardened accordingly: it binds `127.0.0.1` only, validates the `Host` header
  (anti-DNS-rebinding), gates every API call behind a per-session token injected into
  the served page (cross-origin pages cannot read it), refuses to be framed, and starts
  an action only from a `POST`. It runs external tools only via `spawn`/`execFile` with
  **argument arrays built from validated values — never a shell**. Any request-derived
  value that can reach an argument or a filesystem path (L1 name, chain id, token
  symbol, amount) is whitelist-validated first. An Interchain message must be
  non-empty, at most 256 bytes of UTF-8, and may not start with `-`; its text never
  reaches a command line, because Studio ABI-encodes the call and passes `cast` the
  calldata. avalanche-cli actions run one at a time and are owned by the Studio
  server, not by the browser tab.

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
