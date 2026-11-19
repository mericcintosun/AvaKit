# The remaining milestone: an approval-gated agent layer for Avalanche (USD 6,500, Fuji)

**Goal:** make Avalanche the easiest chain to build with and for AI agents. One prompt takes any developer from an empty laptop to a contract verified on Builder Hub, an ERC-8004 agent identity and a paid x402 call in Fuji USDC, with no account, inside spend limits a human set. Mainnet stays a separate, reviewed step.

This milestone replaces milestones 2 to 4 of the July application. Milestone 1 has shipped (see [evidence.md](evidence.md)).

## Why this, why now

- **Avalanche bet on agent payments in 2026.**
  - It is a founding member of Rain's Agentic Payments Alliance ([2026-08-18](https://www.rain.xyz/resources/rain-launches-the-agentic-payments-alliance)).
  - ERC-8004 has been live on C-Chain since [February 2026](https://x.com/avaxdevelopers/status/2019811853082505241).
  - Kite went live as an agent-payments L1 ([2026-04-28](https://www.avalanche.com/about/blog/1-9-billion-interactions-later-it-goes-live)).
  - Team1 wrote that "agent-driven payments became a real focus, not just a talking point" ([August 2026 recap](https://www.team1.blog/p/avalanche-august-2026-recap)).
- **Team1 chapters already teach agents; the shared kits do not.** Seoul (Claude and x402 quests), LatAm, Africa's Agentic AI Mini Hack and Thailand (policy-gated agents) ran agent sessions in 2026. Team1's [shared workshops repository](https://github.com/avalancheteam1/workshops) has eight workshops, and none covers agents or x402 (checked 2026-11-19).
- **The official stack stops short of acting.**
  - The Builder Hub MCP server is [read-only by design](https://build.avax.network/docs/tooling/ai-llm/mcp-server). Ava Labs' own roadmap asked for a separate local operator MCP that is "approval-gated and safe by default"; the epic closed on 2026-10-19 with none published ([issue 4070](https://github.com/ava-labs/builders-hub/issues/4070)).
  - The official x402 course needs a thirdweb account and secret key, an ERC-4337 server wallet and an OpenRouter key before the first payment.
  - The x402 SDK (`@x402/evm`) has no Fuji default asset.
  - Builder Hub has no ERC-8004 page ([llms-full.txt](https://build.avax.network/llms-full.txt), checked 2026-11-19).
- **AvaKit already acts.** Its MCP server is the only Avalanche server in the official MCP Registry that performs write actions. It deploys and mints on Fuji with no key ([proof](evidence.md)).

## Deliverables

Rate: USD 50 an hour, 130 hours, about eight weeks. Everything is MIT-licensed and released to npm with provenance. Each item is checkable without me.

| # | Deliverable | Done when (checkable) | Weeks | USD |
|---|---|---|---|---|
| D1 | **Policy-gated execution.** The MCP server enforces a project policy on every write: spend caps per call, session and day (AVAX and USDC), allowlists of contracts, methods and x402 hosts, a gas cap, and human confirmation above a threshold (fail closed when the client cannot ask). Every write is recorded in a hash-chained audit log, which an `agent_activity` tool reads. | Released on npm. Public CI tests prove that over-cap, off-allowlist and above-threshold calls are refused or held. A replay script matches a Fuji session's audit log to the chain. | 1–2 | 1,100 |
| D2 | **Agent payments with no account (x402).** `x402_quote` and `x402_pay` tools pay inside D1's caps, and a payment counts only on its settlement transaction. An `x402-api` template serves a paid route on the official x402 v2 packages. The AvaKit faucet adds a small Fuji USDC drip. Upstream: a PR adding Fuji USDC to the x402 SDK's default assets. | A daily CI leg scaffolds the template, serves it and pays it from a second session wallet on a fresh runner, with the settlement link in the log. The upstream PR is open with checks passing. | 2–4 | 1,800 |
| D3 | **Agent identity (ERC-8004).** `agent_register`, `agent_lookup` and `agent_feedback` tools, where feedback is accepted only with a payment between the two parties (the spec's `proofOfPayment`). An `erc8004-agent` template. Upstream: a Builder Hub docs PR, "ERC-8004 on Avalanche". | A Fuji registration and its agentId. Named tests: feedback is refused without a settlement and accepted with one. The docs PR is open. | 4–5 | 1,000 |
| D4 | **Hand-off to the official stack.** Contracts deployed on Fuji are verified automatically on Builder Hub's verifier, with an opt-out. A read-only `mainnet_plan` tool packages the verified address, tests, policy, audit log and live mainnet gas for the reviewed route (Audit Marketplace, Console), and never deploys. | The CI-deployed contract shows verified source on the Builder Hub explorer. A test proves `mainnet_plan` sends nothing. The MCP Registry entry is refreshed. | 3–5 | 600 |
| D5 | **Team1 workshop kit, English and Turkish:** "Your agent's first paid call on Avalanche". A 60–90 minute session: install, scaffold, fund with no account, deploy and verify, register an agent, serve a paid API, let a second agent pay, leave payment-backed feedback, read the audit log. Includes slides, a facilitator script, offline fallbacks, and Claude Code and Cursor skills offered to Team1 Türkiye's SnowShoe. | A PR in `avalancheteam1/workshops` with its validation passing. A recorded clean-machine dry run. One open online session I run, with its completion rate published. | 6–7 | 1,100 |
| D6 | **Public outcome ledger and reports.** Opt-in entries by outside builders: their handle, OS, path, and the deploy, verification, registration and settlement links. My runs and CI runs are listed apart, and failed attempts are kept. A pilot report in week 8, then updates at 30, 90 and 180 days. | Every ledger link resolves to a successful Fuji transaction. The report gives started against completed, median time to the first paid call, drop-offs, and fixes released. | 7–8, then +30/+90/+180 days | 900 |
| | **Total** | | | **6,500** |

## Targets

| Metric | Baseline (2026-11-19) | Target |
|---|---|---|
| Outside builders completing the agent path on their own machines (deploy, verify, register, paid call), with links in the ledger | 0 | 5 within 30 days of delivery; 12 by day 90, at least 3 through Team1 channels |
| Outside builders completing the first-run path (scaffold, deploy, mint) with public links | 0 validated. The [public counter](https://avakit.dev/stats) shows 10 anonymous scaffolds since 15 July. | 15 by day 90 |
| Workshop completion rate (finished out of started, failures included) | no sessions yet | 60% or more, reported even when lower |
| Median time from install to first settled x402 payment, on a clean machine | not possible today | under 15 minutes |
| Builders who come back to deploy again or ship their own agent | 0 | 3 by day 90 |

## Payment and limits

- **Payment, in three stages:**
  - USD 2,000 on approval;
  - USD 3,000 on accepted delivery (Team1 reruns the acceptance checks above);
  - USD 1,500 when five builders other than me have completed the agent path, with public evidence, within 30 days of acceptance.
- **If the stage-3 target is missed,** I report the real number with every failure, and Team1 decides. Two stages of USD 3,250 work as well. Overruns are mine.
- **Risk limits:**
  - Fuji only.
  - Session wallets live in memory and never appear in tool arguments.
  - Spend caps and allowlists apply to every write.
  - Faucet drips are capped per address and per IP.
  - No custody, and no personal data beyond a handle a builder chooses to publish.
  - Mainnet stays off, behind the existing double gate and outside this milestone.
- **Schedule risk is mine.** The build order is D1, D2, D4, D3, D5, D6. If a week slips, I say so early. The first things cut would be payment-backed feedback and `mainnet_plan`, never the policy layer, the payment path or the ledger.

## Funding, separated

| Part | Asked |
|---|---|
| Everything shipped before the application, and milestone 1 | USD 0 |
| The work of 17–19 November 2026 (review, key-free agent path, failure handling, daily clean-machine run, hardened faucet) | USD 0 |
| Team1 integration so far: none | USD 0 |
| Other support: none. In July a Team1 member reviewed AvaKit and contributed a security pass as an unpaid volunteer. | n/a |
| Component library and 1.0 (application milestones 2 and 4) | not requested |
| Mainnet | not requested; a separate, reviewed step |
| **This milestone** | **USD 6,500** |

## Who maintains it, and after the grant

- **Maintenance.** I maintain AvaKit, eight hours a week for twelve months after the grant:
  - security reports through GitHub private reporting, acknowledged within three business days;
  - a first answer on issues within seven days;
  - a release with notes at least quarterly.
- **Continuity.** Releases are built in CI with provenance and no stored token. A second maintainer with release rights, from among the builders this brings in, is a goal.
- **Next, to show where this goes:**
  - Move the L1, ICM and bridge templates off Avalanche CLI, which is in maintenance mode, onto the supported toolchain.
  - Business starters for Avalanche's 2026 pillars: stablecoin checkout and payouts, tokenised assets with confidential balances, passkey accounts.
  - A reviewed route from Fuji agents to production.
  - AvaKit 1.0, with chapter kits in more Team1 languages.
