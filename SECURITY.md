# Security Policy

AvaKit deals with wallets and on-chain deployments, so we take security seriously.

## Core guarantees

- **With a real wallet, the end-user's private keys stay with the wallet provider.**
  For the social-login (Web3Auth) and injected (Core/MetaMask) adapters, key
  generation, storage, and signing live inside the wallet provider — AvaKit's browser
  code only uses a signing interface and never sees a seed phrase or private key.
  **The burner adapter is the deliberate exception — see below.**
- **No secrets in code or logs.** Secrets — deploy keys, RPC and API keys — are read
  from environment variables and are never written to logs or tool output. (The
  Web3Auth client ID bundled in the scaffolded templates is not a secret: a client ID
  is a public identifier that reaches every browser anyway, and this demo one only
  allows localhost origins, so social login works with zero setup. Set
  `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` to use your own.)
- **Mainnet is opt-in.** Deploys default to the Fuji testnet, and a mainnet deploy is
  refused until it is confirmed explicitly. `deployContract()` in `@avakit/core` (and
  `useAvaDeploy()` in `@avakit/react`) throws unless the caller passes
  `confirmMainnet: true`. `@avakit/mcp`'s `deploy_contract` needs `confirm: true` in
  the tool call **and** `AVAKIT_ALLOW_MAINNET=1` in the server's environment — see
  [Local developer tooling](#local-developer-tooling).

## The burner wallet holds a key in the browser

`burnerAdapter()` (`@avakit/core`) is the zero-setup path that lets a stranger try a
real Fuji transaction without installing a wallet, and every scaffolded template wires
it up. It is the one place AvaKit itself handles a key, so be precise about what it
does:

- It calls viem's `generatePrivateKey()` **in the browser** and, by default, persists
  that key to **`localStorage` in the clear** (`avakit.burner.pk`). Any script running
  on the page can read it. There is no HSM and no enclave.
- That is the intended trade-off for a **throwaway testnet identity holding a faucet
  drip**, and nothing else. It is not a wallet; treat it as a session.
- Never send real funds to a burner address, and never present a burner as a way to
  hold value. `clearBurner()` deletes the key. Pass `persist: false` to keep it in
  memory only.
- The other adapters are the upgrade path: a user with Core/MetaMask or social login
  gets provider-held keys, and the guarantee above applies to them.

## Local developer tooling

Some AvaKit surfaces run on the developer's own machine and use keys locally. This is
by design and is scoped to local/testnet use:

- **The EWOQ key** (`0x56289e99…8027`) that appears in scaffolder templates and Studio
  is Avalanche's well-known **public** development key. It is pre-funded only on local
  devnets, is documented as local-only, and is never a real secret.
- **`@avakit/mcp`'s `deploy_contract`** signs with a key supplied via the
  `AVAKIT_DEPLOYER_KEY` environment variable. It is never logged, and the tool refuses
  to deploy with a key that has no balance. A mainnet deploy needs **two** independent
  approvals: `confirm: true` in the tool call **and** `AVAKIT_ALLOW_MAINNET=1` in the
  environment the MCP server runs in. `confirm: true` alone is refused, on purpose: an
  AI agent can be talked into passing it by a prompt-injected instruction, but it
  cannot change the server's environment, so a malicious prompt on its own can never
  spend real funds. Leave `AVAKIT_ALLOW_MAINNET` unset for everyday testnet work.
- **`@avakit/studio`** runs a local control center that can drive `avalanche-cli`,
  `forge`, and `cast`. It is a tool you launch yourself from your own terminal, and is
  hardened accordingly: it binds `127.0.0.1` only, validates the `Host` header
  (anti-DNS-rebinding), gates every API call behind a per-session token injected into
  the served page (cross-origin pages cannot read it), and runs external tools only via
  `spawn`/`execFile` with **fixed argument arrays — never a shell string**. Any
  request-derived value (L1 name, chain id, token, amount) is strictly whitelist-validated
  before it can reach an argument or a filesystem path.

## Reporting a vulnerability

Please do not open a public issue, discussion, or pull request for a security
vulnerability. Report it privately instead, so a fix can be prepared before disclosure:

**[Report a vulnerability](https://github.com/mericcintosun/AvaKit/security/advisories/new)**
— GitHub's private vulnerability reporting, also reachable from the **Security** tab of
the repository (**Report a vulnerability**). All you need is a GitHub account; the
report is visible only to you and the maintainers.

It helps to include the affected package and version (or commit), what an attacker
could do, and the steps or a proof of concept that reproduce it.

We aim to acknowledge reports promptly and will coordinate a disclosure timeline with
you in that advisory.

## Supported versions

AvaKit is in early (0.x) releases. Security fixes target the latest published versions
and the `main` branch until a stable release line is established.
