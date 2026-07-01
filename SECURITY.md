# Security Policy

AvaKit deals with wallets and on-chain deployments, so we take security seriously.

## Core guarantees

- **AvaKit never handles private keys.** Key generation, storage, and signing live
  inside the wallet provider (e.g. Web3Auth / AvaCloud WaaS, backed by HSMs/enclaves).
  AvaKit code only uses a signing interface.
- **No secrets in code or logs.** Client IDs, RPC keys, and similar values are read
  from environment variables and are never written to logs or tool output.
- **Mainnet is opt-in.** Deploys default to the Fuji testnet. Mainnet deploys require
  explicit confirmation and a balance check.

## Reporting a vulnerability

Please do not open a public issue for security vulnerabilities. Instead, report them
privately to the maintainers so a fix can be prepared before disclosure. We aim to
acknowledge reports promptly and will coordinate a disclosure timeline with you.

## Supported versions

AvaKit is pre-release (M0). Security fixes target the latest `main` until a stable
release line is established.
