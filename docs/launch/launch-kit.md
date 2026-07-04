# AvaKit — Launch Kit

Copy-paste assets for launching AvaKit. Facts to keep consistent everywhere:

- **One-liner:** The open-source, AI-native developer toolkit for Avalanche.
- **Command:** `npm create avalanche-app@latest`
- **Demo video:** https://youtu.be/GeSpcrmIpnc
- **Site:** https://avakit.dev · **Docs:** https://avakit.dev/docs · **Templates:** https://avakit.dev/templates
- **GitHub:** https://github.com/mericcintosun/AvaKit · **npm:** https://www.npmjs.com/package/create-avalanche-app
- **License:** MIT · **Status:** 0.x, shipped (all 5 packages on npm, 8 templates, live on Fuji)
- **Proof:** a real mint tx on Fuji — https://testnet.snowtrace.io/tx/0x9a1f139577964587ac03123d719f25c0b68024a4c8eab0dc258ad9c925a8e090

---

## 1) X / Twitter thread

**1/**
Building on Avalanche used to take hours of setup.

Now it's one command:

`npm create avalanche-app`

→ sign in with Google (no seed phrase)
→ deploy + mint an NFT from the browser
→ live on Avalanche in ~1 minute

Watch 👇
https://youtu.be/GeSpcrmIpnc

**2/**
Meet AvaKit — the open-source, AI-native developer toolkit for Avalanche.

One core, four surfaces:
◆ create-avalanche-app — scaffolder, 8 templates
◆ @avakit/react — `<ConnectAvalanche>` social login
◆ @avakit/mcp — build with Claude Code / Cursor
◆ @avakit/studio — local dev dashboard

**3/**
The onboarding is the magic.

Users sign in with Google. No seed phrases, no wallet setup — keys stay in the provider's HSM; AvaKit never touches them.

Works on localhost out of the box. Bring your own key for production.

**4/**
Deploy-ready by default.

Contracts compile to bundled bytecode, so you deploy an ERC-721 straight from the browser — no Foundry, no backend. Then mint it.

A real on-chain tx on Fuji, verifiable on Snowtrace.

**5/**
AI-native, for real.

Every generated app ships CLAUDE.md, llms.txt, and .cursor/rules. And @avakit/mcp lets your AI agent scaffold, deploy, and read chain state.

Just ask: "Scaffold an nft-mint dapp and deploy it to Fuji."

**6/**
Open-source (MIT). Testnet-first. Built on viem, Web3Auth, and Foundry — we wrap mature pieces instead of rewriting them.

Try it now:
`npm create avalanche-app@latest`

⭐ https://github.com/mericcintosun/AvaKit
📖 https://avakit.dev

It's 0.x and shipping fast — feedback very welcome.

---

## 2) Product Hunt

**Name:** AvaKit
**Tagline (≤60 chars):** From zero to a live Avalanche dapp in one command

**Description:**
AvaKit is the open-source, AI-native developer toolkit for Avalanche. Run one command and you get a modern dapp with social login already wired up — users sign in with Google, no seed phrases. Deploy an NFT contract straight from the browser and mint it on Fuji, no Foundry or backend required. Ships 8 templates, an AI/MCP integration so Claude Code and Cursor can scaffold and deploy for you, and a local dev dashboard (Studio). Built on viem, Web3Auth, and Foundry. MIT licensed.

**First comment (maker):**
Hey Product Hunt 👋 I built AvaKit because getting a modern Avalanche dapp running still took hours — wallet onboarding, boilerplate, deploy tooling. AvaKit makes it one command: `npm create avalanche-app@latest`. Sign in with Google (no seed phrase), deploy + mint from the browser, and you're live on Fuji in about a minute. It's also AI-native — every app ships agent context, and the MCP server lets Claude/Cursor drive it. It's open-source and 0.x, so I'd love your feedback. 90-sec demo: https://youtu.be/GeSpcrmIpnc

---

## 3) dev.to / blog article

**Title:** Build on Avalanche in one command — social login, deploy, and mint from the browser

**Tags:** avalanche, web3, javascript, opensource

**Cover idea:** the ASCII AVAKIT banner or a screenshot of the /terminal page.

---

Building on Avalanche's C-Chain is EVM-compatible and end-user onboarding is basically solved — Core wallet has seedless social login. The friction that's left is on the **developer** side: spinning up a modern dapp with onboarding wired up still takes hours.

So I built **AvaKit** — an open-source, AI-native toolkit that removes that friction. Here's the whole thing:

```bash
npm create avalanche-app@latest
```

Pick a template, pick social login, pick Fuji. That's it.

### Sign in with Google, no seed phrase

The headline feature. Users click "Sign in with Google" and they're in — keys stay inside the provider's HSM, AvaKit never touches them. It works on localhost out of the box with a bundled demo key; you set your own (free, from Web3Auth) before deploying.

### Deploy from the browser

Contracts compile to bundled bytecode, so there's no Foundry or backend at runtime. You click "Deploy," approve in your wallet, and your ERC-721 is live. Then you mint — a real on-chain transaction on Fuji you can verify on Snowtrace.

### AI-native

Every generated app ships `CLAUDE.md`, `llms.txt`, and `.cursor/rules`, so your AI assistant understands the project. And `@avakit/mcp` is an MCP server that lets Claude Code or Cursor scaffold apps, deploy contracts, and read chain state directly. You can literally ask: *"Scaffold an nft-mint dapp and deploy it to Fuji."*

### What's in the box

- `create-avalanche-app` — the scaffolder, 8 templates (minimal, nft-mint, token-gated, erc20, ICM messenger, encrypted-ERC, L1 launch, token bridge)
- `@avakit/react` — `<ConnectAvalanche>`, `<TransactionButton>`, hooks, on shadcn/ui
- `@avakit/core` — framework-agnostic kernel (viem clients, adapters, deploy helpers)
- `@avakit/mcp` — the AI/MCP server
- `@avakit/studio` — a local dashboard to spin up devnets, send Interchain messages, and inspect data

The philosophy is **wrap, don't rewrite**: it's built on viem, Web3Auth, and Foundry, packaged for a great DX. It's MIT-licensed and testnet-first (mainnet is explicit opt-in).

Try it, and tell me what breaks:

```bash
npm create avalanche-app@latest
```

- GitHub: https://github.com/mericcintosun/AvaKit
- Docs: https://avakit.dev/docs
- 90-second demo: https://youtu.be/GeSpcrmIpnc

---

## 4) Reddit (r/Avax, r/AvalancheAVAX)

**Title:** I built AvaKit — an open-source "create-avalanche-app": one command to a social-login dapp, deploy + mint from the browser

**Body:**
Getting a modern Avalanche dapp running still took hours — wallet onboarding, boilerplate, deploy tooling. So I made AvaKit, an open-source toolkit that turns it into one command:

`npm create avalanche-app@latest`

- Sign in with Google, no seed phrase (Web3Auth; keys never touch the app)
- Deploy an NFT contract from the browser and mint it on Fuji — no Foundry, no backend
- 8 templates, an AI/MCP integration (Claude Code / Cursor can scaffold + deploy for you), and a local dev dashboard
- Built on viem + Web3Auth + Foundry, MIT licensed, testnet-first

90-second demo: https://youtu.be/GeSpcrmIpnc · Repo: https://github.com/mericcintosun/AvaKit

It's 0.x and I'm shipping fast — feedback and issues very welcome.

---

## 5) Discord (Avalanche dev channels) — short

Just shipped **AvaKit** 🔺 — open-source `create-avalanche-app`. One command → a social-login (Google, no seed phrase) Avalanche dapp, deploy + mint from the browser on Fuji, plus an MCP server so Claude/Cursor can build it for you. 90s demo: https://youtu.be/GeSpcrmIpnc · repo: https://github.com/mericcintosun/AvaKit — would love feedback.

---

## 6) Ecosystem submission blurb (Builder Hub, awesome-avalanche, directories)

**AvaKit** — The open-source, AI-native developer toolkit for Avalanche. Scaffold a deploy-ready dapp with social-login onboarding in one command (`npm create avalanche-app`), deploy and mint from the browser on Fuji, and let AI agents drive it via MCP. Includes a React widget library, a framework-agnostic core, 8 templates, and a local dev dashboard. Built on viem, Web3Auth, and Foundry. MIT. https://avakit.dev · https://github.com/mericcintosun/AvaKit

---

## Launch checklist

- [ ] YouTube video public + title/description/tags set (see the earlier metadata)
- [ ] README video badge live (done) + repo topics set (avalanche, web3, nextjs, cli, mcp, scaffolding)
- [ ] Enable GitHub Discussions (issue template `config.yml` links to it)
- [ ] Post the X thread (pin it); tag @avax / Avalanche accounts where appropriate
- [ ] Publish the dev.to article; cross-post to the blog
- [ ] Product Hunt submission (schedule for a weekday 12:01am PT)
- [ ] Reddit post to r/Avax
- [ ] Announce in Avalanche Discord dev channels
- [ ] Submit to Avalanche Builder Hub / awesome-avalanche / relevant directories
- [ ] Smoke-test `npm create avalanche-app@latest` one more time right before posting
