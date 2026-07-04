# AvaKit — Content Calendar (30 days, ~15 posts)

Post every ~2 days. Written for Typefully (paste/import, then schedule). Facts &
links live in `launch-kit.md`. Attach the noted visual to each post.

Handle: **@avakitdev** · site: **avakit.dev**

## Voice / style rules

- **lowercase everything.** the only word always capitalized is **AvaKit** (and
  **Avalanche** when it's the network's name in a sentence). tools, names, and
  commands stay lowercase: fuji, mcp, claude, cursor, next.js, snowtrace, google.
- **no em dashes (—).** don't lean on hyphens as pauses either. break the line, or
  use a middle dot `·`. commas and periods are fine.
- **short lines, blank line between thoughts.** give it air.
- **one idea per post, one action** (a command, a link, or a question).
- the **🔺** (avalanche red triangle) is fine as an accent, used sparingly, usually
  right after AvaKit or on a punchy last line.
- **sound like a builder typing fast, not a brand.** no "unlock", "seamless",
  "revolutionary", "empower", "supercharge". no perfectly balanced marketing lines.
- **show, don't tell:** a command, a real tx, one line of code beats any adjective.
- bare domains (avakit.dev), not https://, so they read clean.

---

### 1 — hero  · [visual: 90s demo video]
one command and you've got a modern Avalanche dapp 🔺

npm create avalanche-app@latest

sign in with google, no seed phrase.
deploy + mint from the browser.
live on fuji in about a minute.

demo:

### 2 — social login  · [visual: google login → wallet address clip]
"no seed phrase" isn't a slogan, it's the default.

on AvaKit your users sign in with google. the keys stay in the provider's hsm, the app never touches them.

works on localhost out of the box.

### 3 — browser deploy  · [visual: deploy → mint → snowtrace]
no foundry. no backend.

AvaKit bundles the contract bytecode, so you deploy an erc-721 straight from the browser and mint it.

that mint is a real tx on fuji. here it is on snowtrace:

### 4 — mcp / ai  · [visual: mcp tool call in cursor]
your ai editor can build on Avalanche now.

the AvaKit mcp server lets claude code and cursor scaffold apps, deploy contracts, and read chain state.

just ask it:
"scaffold an nft-mint dapp and deploy it to fuji"

### 5 — templates  · [visual: template gallery]
8 ways to start:

minimal · nft-mint · token-gated · erc20 · icm messenger · encrypted-erc · launch-your-own-l1 · token-bridge

each one ships social login, shadcn/ui, and ai context. ready to run.

### 6 — studio  · [visual: studio dashboard + boot splash]
local Avalanche dev without the yak-shaving.

AvaKit studio spins up devnets, sends interchain messages, and inspects chain data from one dashboard.

npx @avakit/studio

### 7 — build in public  · [visual: the ink terminal wizard]
spent the week making create-avalanche-app feel like a product, not a script.

rebuilt the whole flow with ink (react in the terminal): bordered panels, live progress, a review step.

and it starts your app for you.

### 8 — team1 application (tag global team1)  · [visual: banner / demo]
applying to @team1 with AvaKit 🔺

the idea: building on Avalanche should feel like create-next-app.

one command, a social-login dapp, deploy + mint from the browser, ai-native by default. open source, shipping fast.

avakit.dev

### 9 — code tip  · [visual: code screenshot]
social-login onboarding on Avalanche is basically this:

<AvaKitProvider chains={[fuji]} adapters={[web3authAdapter({ clientId })]}>
  <ConnectAvalanche />
</AvaKitProvider>

that's the whole wallet layer.

### 10 — demo re-share  · [visual: 90s demo video]
if you build on Avalanche, give this 90 seconds.

zero to a live social-login dapp with a real mint on fuji, from one command.

### 11 — poll  · [native poll, no image]
building on Avalanche, what slows you down the most?

wallet onboarding
deploy tooling
boilerplate
reading chain state

(building AvaKit to kill all four, curious which one hurts)

### 12 — open source  · [visual: repo screenshot]
AvaKit is mit and built in the open.

issues, prs, template ideas all welcome. there's a contributing guide and a pile of good-first-issues.

github.com/mericcintosun/AvaKit ⭐

### 13 — confidential tokens  · [visual: eerc demo]
private tokens on Avalanche, scaffolded.

the eerc-token template does confidential transfers with hidden balances (encrypted erc + zk). register, mint, transfer privately.

npm create avalanche-app@latest

### 14 — cross-chain  · [visual: two-l1 devnet]
two Avalanche l1s, one message.

the icm-messenger template spins up a local 2-l1 devnet with interchain messaging in one command.

build cross-chain without the setup pain.

### 15 — milestone  · [visual: banner]
AvaKit this week: an ink cli, social-login by default, an estimate_gas mcp tool, real tests, and a launch.

thanks to everyone testing and sending feedback 🙏

if you haven't yet:
npm create avalanche-app@latest 🔺

---

## Screenshots → posts

Generated shots live in `docs/launch/screenshots/` (local, gitignored). Attach:

- **1 hero** → `09-cli-banner.png` (or the demo video)
- **2 social login** → your own "sign in with google → wallet address" screenshot
- **3 browser deploy** → your own deploy → mint → snowtrace screenshot
- **4 mcp / ai** → `05-docs-mcp.png` (or a cursor mcp-call screenshot)
- **5 templates** → `03-templates.png`
- **6 studio** → `07-studio-dashboard.png` (or `10-studio-cli.png`)
- **7 build in public** → `02-terminal-page.png` (or your wizard screenshot)
- **8 team1** → `01-landing.png` (or `09-cli-banner.png`)
- **9 code tip** → a screenshot of the snippet in your editor
- **10 demo re-share** → the demo video
- **11 poll** → none (native poll)
- **12 open source** → a screenshot of the github repo
- **13 confidential (eERC)** → your own eerc screenshot, or none
- **14 cross-chain (ICM)** → `07-studio-dashboard.png`, or none
- **15 milestone** → `09-cli-banner.png`

## Using Typefully

1. connect the typefully mcp (see the recommendation), or use the web app.
2. paste these posts, schedule every 2 days across ~30 days (15 fits the monthly allowance).
3. front-load the strongest ones (1, 2, 3, 8, 10) in week one.
4. attach the noted visual to each. posts with media reach far more people.
5. reply to every comment in the first hour. comments and likes will come, engage them.
