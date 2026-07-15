# Security Policy

AvaKit deals with wallets and on-chain deployments, so we take security seriously.

## Core guarantees

- **With a real wallet, the end-user's private keys stay with the wallet provider.**
  For the social-login (Web3Auth) and injected (Core/MetaMask) adapters, key
  generation, storage, and signing live inside the wallet provider — AvaKit's browser
  code only uses a signing interface and never sees a seed phrase or private key.
  **The burner adapter is the deliberate exception — see below.**
- **No secrets in code or logs.** Client IDs, RPC keys, and similar values are read
  from environment variables and are never written to logs or tool output.
- **Mainnet is opt-in.** Deploys default to the Fuji testnet. Mainnet deploys require
  explicit confirmation and a balance check.

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
  `AVAKIT_DEPLOYER_KEY` environment variable. It is never logged, and mainnet deploys
  require explicit confirmation.
- **`@avakit/studio`** runs a local control center that can drive `avalanche-cli`,
  `forge`, and `cast`. It is a tool you launch yourself from your own terminal, and is
  hardened accordingly: it binds `127.0.0.1` only, validates the `Host` header
  (anti-DNS-rebinding), gates every API call behind a per-session token injected into
  the served page (cross-origin pages cannot read it), and runs external tools only via
  `spawn`/`execFile` with **fixed argument arrays — never a shell string**. Any
  request-derived value (L1 name, chain id, token, amount) is strictly whitelist-validated
  before it can reach an argument or a filesystem path.

## Reporting a vulnerability

Please do not open a public issue for security vulnerabilities. Instead, report them
privately to the maintainers so a fix can be prepared before disclosure. We aim to
acknowledge reports promptly and will coordinate a disclosure timeline with you.

## Supported versions

AvaKit is in early (0.x) releases. Security fixes target the latest published versions
and the `main` branch until a stable release line is established.
