# Security Policy

AvaKit deals with wallets and on-chain deployments, so we take security seriously.

## Core guarantees

- **The end-user's private keys stay with the wallet provider.** For app users, key
  generation, storage, and signing live inside the wallet provider (e.g. Web3Auth /
  AvaCloud WaaS, backed by HSMs/enclaves). AvaKit's browser code only uses a signing
  interface — it never sees a seed phrase or private key.
- **No secrets in code or logs.** Client IDs, RPC keys, and similar values are read
  from environment variables and are never written to logs or tool output.
- **Mainnet is opt-in.** Deploys default to the Fuji testnet. Mainnet deploys require
  explicit confirmation and a balance check.

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
