# AvaKit — Content Calendar v2 (post-launch, after 4 Aug)

> **v1** (`content-calendar.md`) is the 15-post launch batch, **live and scheduled
> in Typefully, 7 Jul → 4 Aug — do not touch it.** This is **v2: the "rebuild &
> relaunch" arc** for **after 4 Aug**, built around the new vision (zero-barrier,
> AvaKit Cloud, AI-native front door). Same voice. These become a **second
> Typefully batch**, scheduled every 2 days, once the features they reference ship.
>
> Handle: **@avakitdev** · site: **avakit.dev**

## Voice / style rules (unchanged from v1 — restated)

- **lowercase everything.** only **AvaKit** (and **Avalanche** as the network name)
  is capitalized. fuji, mcp, claude, cursor, next.js, snowtrace, google, core,
  metamask, stackblitz, codespace stay lowercase.
- **no em dashes (—).** don't lean on hyphens as pauses. break the line, or use a
  middle dot `·`. commas and periods are fine.
- **short lines, blank line between thoughts. one idea, one action.**
- **🔺** sparingly, usually after AvaKit or on a punchy last line.
- **sound like a builder typing fast, not a brand.** no "unlock", "seamless",
  "revolutionary", "empower", "supercharge".
- **show, don't tell:** a command, a real tx, one line of code, a link to a thing
  that runs.
- bare domains (avakit.dev), not https://.

## The arc

Month 1 said "we shipped." Month 2 says **"we heard the feedback, we killed the
barriers, now anyone can try it in 60 seconds."** Every post ladders to one of:
*try it now* · *we removed a barrier* · *AI builds on Avalanche* · *proof* ·
*ecosystem*. Front-load the relaunch (1, 2, 4, 6). Two anchor beats: the **`/new`
relaunch** and the **grant/listing announcement** when they land.

## Scheduling

Every 2 days at 15:00 UTC (18:00 Istanbul), starting the first slot after 4 Aug
(≈ **6 Aug → 3 Sep**, 15 posts). **Gate each post on its feature shipping** — the
`[needs:]` tag says what must be live first; if it isn't, hold that post or use its
fallback. Create these as a Typefully v2 batch (same flow as v1) when ready.

---

### 1 — relaunch (anchor)  · [visual: /new live demo clip]  · [needs: avakit.dev/new]
we rebuilt avakit's onboarding from scratch.

you can now do a real avalanche mint in your browser. no wallet, no signup, no gas, no install.

try it, it takes a minute:
avakit.dev/new 🔺

### 2 — build in public (the feedback)  · [visual: before/after or plain text]
an avalanche team1 lead told me the truth about avakit:

"it's too dependent. a new user can't just dive in."

he was right. so i spent the last weeks killing every setup step. here's what changed 👇

### 3 — barrier: the wallet  · [visual: the "do you have a wallet?" prompt]
you used to need a web3auth key just to try avakit.

not anymore. open the app and a wallet is right there.

got core or metamask? it asks first.
if you don't, it makes you a temporary one.
you're just in.

### 4 — barrier: gas + faucet  · [visual: mint with no funding step]  · [needs: hosted faucet]
the old first transaction: go find a fuji faucet, prove you hold mainnet avax, wait, come back.

the new one: you click mint. we fund it. it's gasless.

that's the whole point. the friction was never the code, it was the setup.

### 5 — barrier: the toolchain  · [visual: browser deploy clip]
you don't need foundry or avalanche-cli to start anymore.

deploy a real contract straight from the browser.

still want the full local toolchain? one click opens a codespace with everything already installed.

### 6 — ai-native  · [visual: mcp tool call in cursor/claude]
ask claude code: "build an avalanche nft app and deploy it to fuji."

the avakit mcp actually does it. scaffold, deploy, mint.

avalanche's official mcp only reads docs. ours acts 🔺

### 7 — try it (sandbox)  · [visual: stackblitz boot, ~10s]  · [needs: stackblitz buttons]
10 seconds. no install.

click "open in stackblitz" and you've got a running avalanche dapp in your browser.

every template. go break one.

### 8 — avakit cloud  · [visual: simple cloud diagram]  · [needs: avakit cloud]
new: avakit cloud.

a hosted faucet, a gasless paymaster, and rpc, so your users never touch setup.

fully open source. self-host all of it if you want. we just run it so you don't have to.

avakit.dev

### 9 — mascot / brand  · [visual: `apps/web/public/brand/avafox.png`]  · [ready]
meet avafox 🔺

he'll be showing you around avakit from here on.

(the 3d one at avakit.dev/avatar is his softer twin. long story.)

### 10 — code tip: gasless  · [visual: code screenshot]
gasless on avalanche, the whole setup:

<AvaKitProvider sponsorGas>
  <ConnectAvalanche />
</AvaKitProvider>

your users mint without ever holding avax.

### 11 — wrap, not replace  · [visual: stack diagram]
avakit isn't a new avalanche sdk.

it's the 60-second front door to the real one.

under the hood it's avacloud, the avalanche sdk, icm, viem. we just made all of it usable in a minute.

### 12 — proof / metrics  · [visual: /stats page]  · [needs: telemetry + /stats]
building in the open, so here's the scoreboard.

since launch: [X] apps scaffolded, [Y] shipped on avalanche with avakit.

live, always, at avakit.dev/stats 🔺

### 13 — ecosystem  · [visual: builder hub listing]  · [needs: builder hub PR merged]
avakit is now in the avalanche builder hub.

building on avalanche should start with one command:

npm create avalanche-app@latest

### 14 — template spotlight (eerc)  · [visual: eerc demo, working]  · [needs: eerc fix]
private tokens on avalanche, now working out of the box in the browser.

register, mint, transfer with hidden balances. no setup, no reverts.

confidential by default 🔺

### 15 — month wrap / vision  · [visual: banner or mascot]
month one: we shipped avakit.

month two: we made it something a stranger can use in 60 seconds.

next: the default way anyone builds on avalanche 🔺

npm create avalanche-app@latest

---

## Notes for creating the v2 Typefully batch

1. **Do not touch the v1 drafts** (ids from the launch batch, scheduled through 4
   Aug). This is a separate batch.
2. **Only schedule a post once its `[needs:]` feature is live.** If `/new`, the
   faucet, mascots, `/stats`, or the Builder Hub listing slip, hold that post or
   use a fallback (e.g. post 1 falls back to a demo-video re-share until `/new`
   ships).
3. **Front-load** 1, 2, 4, 6 in the first week of the batch (strongest hooks).
4. Attach the noted visual to every post. Posts 8, 9, 12, 13 depend on new assets
   (cloud diagram, mascot render, stats screenshot, listing screenshot).
5. Reply to every comment in the first hour, especially on the relaunch thread.
6. When ready, create via the same Typefully REST flow used for v1 (drafts →
   attach media → PATCH `publish_at`, 2 days apart), or the Typefully MCP.
