# @avakit/studio

A local control center for Avalanche development — L1s, Interchain Messaging, and devnets — in your browser.

```bash
npx @avakit/studio
```

It starts a small server on `127.0.0.1`, opens your browser, and shows what your machine has ready for Avalanche work (avalanche-cli, Foundry, local L1s) plus the AvaKit project you're in.

## Why it's safe

Studio is a tool **you launch yourself** from your terminal (like Prisma Studio). It:

- binds to `127.0.0.1` only — never reachable from the network,
- validates the `Host` header (defends DNS rebinding),
- gates its API behind a per-session token injected into the served page (a cross-origin page can't read it),
- runs external tools only via `execFile` with fixed arguments — never a shell string, so there's no command injection.

## Status

Phase 1: environment inventory + secure local server. Devnet controls, chain/contract explorer, and the ICM message view land in later phases.

MIT © AvaKit contributors
