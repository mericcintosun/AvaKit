---
"create-avalanche-app": patch
---

Social login now works out of the box on localhost. The social-login templates
(minimal, nft-mint, token-gated-app, erc20-token, eerc-token) ship a bundled demo
Web3Auth client ID, so `npm create avalanche-app` → `pnpm dev` → "Sign in with
Google" works with zero setup — no dashboard signup or `.env.local` editing first.
Set your own `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` before deploying (the demo key only
allows localhost origins). The three local-devnet templates (icm-messenger,
l1-launch, token-bridge) stay injected-only by design.
