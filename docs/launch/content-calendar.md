# AvaKit — Content Calendar (30 days, ~15 posts)

Post every ~2 days. Written for Typefully (paste/import, then schedule). Facts &
links live in `launch-kit.md`. Attach the noted visual to each post — the social
lead's advice: **explain the project, back it with visuals, tag global Team1 on
the application post.** (Confirm the exact @handles before posting — placeholders
below: `@team1`, `@avax`.)

## Voice

- **Who:** a builder shipping in public. Confident, concise, never hypey.
- **Show, don't tell:** demos, real txs, one-liners of code. Let the product talk.
- **Honest:** it's 0.x, shipping fast, feedback-welcome. No overclaiming.
- **Avalanche-native, dev-first.** Sparse emoji (🔺 / ▲). No threads unless earned.
- **Every post:** one clear idea + one action (link, command, or question).

---

### 1 — Hero (one command)  · [visual: 90s demo video]
one command is the whole setup for a modern Avalanche dapp:

`npm create avalanche-app`

→ sign in with Google (no seed phrase)
→ deploy + mint from the browser
→ live on Fuji in ~1 min

demo 👇 https://youtu.be/GeSpcrmIpnc

### 2 — Social login  · [visual: Google login → wallet address clip]
"no seed phrase" isn't a slogan — it's the default.

On AvaKit users sign in with Google. Keys stay in the provider's HSM; the app never touches them. Works on localhost out of the box.

### 3 — Browser deploy  · [visual: deploy → mint → Snowtrace]
No Foundry. No backend.

AvaKit bundles your contract's bytecode, so you deploy an ERC-721 straight from the browser and mint it — a real on-chain tx on Fuji you can verify on Snowtrace.

### 4 — AI-native / MCP  · [visual: MCP tool call in Cursor]
Your AI editor can build on Avalanche now.

@avakit/mcp lets Claude Code / Cursor scaffold apps, deploy contracts, and read chain state. Just ask:
"scaffold an nft-mint dapp and deploy it to Fuji."

### 5 — Templates  · [visual: template list / gallery]
8 ways to start:
minimal · nft-mint · token-gated · erc20 · ICM messenger · encrypted-ERC · launch-your-own-L1 · token-bridge

Each ships social login + shadcn/ui + AI context, ready to run.

### 6 — Studio  · [visual: Studio dashboard + boot splash]
Local Avalanche dev without the yak-shaving.

@avakit/studio spins up devnets, sends Interchain messages, and inspects chain data — from one dashboard. `npx @avakit/studio`

### 7 — Build in public: the CLI  · [visual: the Ink terminal wizard]
Spent the week making `create-avalanche-app` feel like a product, not a script.

Rebuilt the flow with Ink (React in the terminal): bordered panels, live progress, a review step — and it starts your app for you.

### 8 — Team1 application (TAG GLOBAL TEAM1)  · [visual: banner / demo]
Applying to @team1 with AvaKit 🔺

The pitch: make building on Avalanche as easy as create-next-app. One command → a social-login dapp, deploy + mint from the browser, AI-native by default. Open-source, shipping fast.
https://avakit.dev

### 9 — Dev tip / code  · [visual: code screenshot]
Social-login onboarding on Avalanche is basically:

```tsx
<AvaKitProvider chains={[fuji]} adapters={[web3authAdapter({ clientId })]}>
  <ConnectAvalanche />
</AvaKitProvider>
```

That's the whole wallet layer. `npm i @avakit/react @avakit/core`

### 10 — Demo re-share  · [visual: 90s demo video]
If you build on Avalanche, spend 90 seconds on this:

zero → a live, social-login dapp with a real mint on Fuji, from one command.
https://youtu.be/GeSpcrmIpnc

### 11 — Engagement poll  · [no visual / native poll]
Building on Avalanche — what slows you down most?

• wallet onboarding
• deploy tooling
• boilerplate
• reading chain state

(building AvaKit to kill all four — curious which hurts most)

### 12 — Open source / contribute  · [visual: repo screenshot]
AvaKit is MIT and built in the open.

Issues, PRs, and template ideas welcome — there's a CONTRIBUTING guide and plenty of good-first-issues.
⭐ https://github.com/mericcintosun/AvaKit

### 13 — Confidential tokens (eERC)  · [visual: eerc demo]
Private tokens on Avalanche, scaffolded.

The `eerc-token` template does confidential transfers with hidden balances (Encrypted ERC + ZK) — register, mint, and transfer privately.
`npm create avalanche-app@latest` → eerc-token

### 14 — Cross-chain (ICM)  · [visual: two-L1 devnet]
Two Avalanche L1s, one message.

The `icm-messenger` template spins up a local 2-L1 devnet with Interchain Messaging in one command — build cross-chain without the setup pain.

### 15 — Milestone + CTA  · [visual: banner]
AvaKit this week: an Ink CLI, social-login-by-default, an estimate_gas MCP tool, real tests, and a launch.

Thanks to everyone testing + sending feedback 🙏
If you haven't yet: `npm create avalanche-app@latest` 🔺

---

## Using Typefully (as the social lead suggested)

1. Connect the **Typefully MCP** to your AI editor (or use Typefully's web app).
2. Paste this file / these posts; ask it to **schedule every 2 days** across ~30 days (15 posts fits the monthly allowance).
3. Front-load the strongest ones (1, 2, 3, 8, 10) in week one.
4. Attach the noted visual to each; posts with media get far more reach.
5. Reply to every comment for the first hour of each post (the lead said comments/likes will come — engage them).
