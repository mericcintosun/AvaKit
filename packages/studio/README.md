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

## What's inside

- **Environment inventory** — avalanche-cli, Foundry, and your local L1s, at a glance.
- **Devnet control** — spin up a two-L1 ICM devnet, start/stop the network, with a **live log** streamed from avalanche-cli. Every command runs via `spawn`/`execFile` with fixed arguments — no shell, no request-derived args.

The UI is React + Tailwind with the same black-and-white shadcn design system as the AvaKit landing.

## Status

Phases 1–2 shipped (inventory + devnet control). Chain/contract explorer, the ICM message view, and an AI/MCP layer land in later phases.

MIT © AvaKit contributors
