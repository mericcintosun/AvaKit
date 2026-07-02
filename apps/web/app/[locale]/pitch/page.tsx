"use client";

import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  Bot,
  Boxes,
  Check,
  Coins,
  KeyRound,
  LayoutDashboard,
  Rocket,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wallet,
} from "lucide-react";
import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/* AvaKit pitch deck — a standalone, presentation-style page (no nav, no buttons).
   Full-screen scroll-snap slides with animated content. 8 slides. */

const fade = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

function Slide({
  n,
  eyebrow,
  children,
  className = "",
}: {
  n: string;
  eyebrow: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`relative flex min-h-dvh snap-start snap-always flex-col justify-center overflow-hidden px-6 py-16 sm:px-12 lg:px-24 ${className}`}
    >
      <div className="pointer-events-none absolute top-8 right-6 font-mono text-xs tracking-[0.3em] text-white/30 sm:right-12 lg:right-24">
        {n} / 08
      </div>
      <div className="pointer-events-none absolute top-8 left-6 flex items-center gap-2 sm:left-12 lg:left-24">
        <Image src="/logo.png" alt="" width={582} height={653} className="h-4 w-auto invert" />
        <span className="font-mono text-xs tracking-[0.25em] text-white/40 uppercase">
          {eyebrow}
        </span>
      </div>
      <div className="mx-auto w-full max-w-5xl">{children}</div>
    </section>
  );
}

function R({
  children,
  i = 0,
  className = "",
}: {
  children: React.ReactNode;
  i?: number;
  className?: string;
}) {
  return (
    <motion.div
      variants={fade}
      custom={i}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.5 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const SURFACES = [
  { icon: Boxes, name: "@avakit/core", note: "viem kernel: wallets, deploy, data" },
  { icon: Wallet, name: "@avakit/react", note: "<ConnectAvalanche> + hooks" },
  { icon: Terminal, name: "create-avalanche-app", note: "batteries-included scaffolder" },
  { icon: Bot, name: "@avakit/mcp", note: "scaffold + deploy from AI agents" },
  { icon: LayoutDashboard, name: "@avakit/studio", note: "local L1 / ICM dev dashboard" },
];

const TEMPLATES = [
  { id: "minimal", art: "/minimal.jpg" },
  { id: "nft-mint", art: "/nft-mint.jpg" },
  { id: "token-gated-app", art: "/token-gated.jpg" },
  { id: "erc20-token", art: "/erc-20.jpg" },
  { id: "icm-messenger", art: "/island.jpg" },
  { id: "eerc-token", art: "/eERC.jpg" },
  { id: "l1-launch", art: "/l1.jpg" },
  { id: "token-bridge", art: "/ictt.jpg" },
];

const METRICS = [
  { icon: Boxes, big: "5", label: "packages published on npm" },
  { icon: Terminal, big: "8", label: "deploy-ready templates" },
  { icon: ShieldCheck, big: "Fuji", label: "proven live, real on-chain tx" },
  { icon: Rocket, big: "1", label: "command to a live dapp" },
];

export default function PitchDeckPage() {
  return (
    <main className="fixed inset-0 z-[100] h-dvh snap-y snap-mandatory overflow-y-auto bg-[#0b0b0c] text-white">
      {/* 01 — Cover */}
      <Slide n="01" eyebrow="Team1 Mini Grant">
        <div className="flex flex-col items-center gap-6 text-center">
          <R>
            <Image
              src="/logo.png"
              alt="AvaKit"
              width={582}
              height={653}
              className="h-24 w-auto invert"
            />
          </R>
          <R i={1}>
            <h1 className="text-6xl font-semibold tracking-tight sm:text-8xl">AvaKit</h1>
          </R>
          <R i={2}>
            <p className="max-w-2xl text-xl text-balance text-white/70 sm:text-2xl">
              The open-source, <span className="text-primary">AI-native</span> create-next-app for
              Avalanche.
            </p>
          </R>
          <R i={3}>
            <p className="font-mono text-sm tracking-[0.3em] text-white/40 uppercase">avakit.dev</p>
          </R>
        </div>
      </Slide>

      {/* 02 — Problem */}
      <Slide n="02" eyebrow="The problem">
        <div className="flex flex-col gap-8">
          <R>
            <h2 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              Building on Avalanche still takes hours, not minutes.
            </h2>
          </R>
          <R i={1}>
            <p className="max-w-3xl text-lg text-white/60 sm:text-xl">
              The C-Chain is EVM-compatible and end-user onboarding is solved (Core's seedless
              wallet). The friction that's left is on the{" "}
              <span className="text-white">developer</span> side.
            </p>
          </R>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              "Wiring wallets, deploy, and onboarding from scratch takes hours.",
              "No batteries-included scaffolder — everyone rebuilds the same setup.",
              "Agents write most boilerplate now, but no Avalanche-native AI tooling.",
            ].map((t, i) => (
              <R key={t} i={i + 2}>
                <Card className="h-full border-white/10 bg-white/[0.03] p-6 text-white/70">
                  {t}
                </Card>
              </R>
            ))}
          </div>
        </div>
      </Slide>

      {/* 03 — Solution */}
      <Slide n="03" eyebrow="The solution">
        <div className="flex flex-col gap-8">
          <R>
            <h2 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              One core, five surfaces. <span className="text-primary">One command</span> to a live
              dapp.
            </h2>
          </R>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {SURFACES.map((s, i) => (
              <R key={s.name} i={i}>
                <Card className="flex h-full flex-col gap-3 border-white/10 bg-white/[0.03] p-5">
                  <div className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                    <s.icon className="text-primary size-4" />
                  </div>
                  <div className="font-mono text-sm font-medium text-white">{s.name}</div>
                  <div className="text-sm text-white/50">{s.note}</div>
                </Card>
              </R>
            ))}
          </div>
          <R i={5}>
            <p className="text-white/50">
              Wrap mature pieces (viem, Web3Auth, Foundry), don't rewrite them. shadcn/ui,
              dark/light from day one, MIT.
            </p>
          </R>
        </div>
      </Slide>

      {/* 04 — How it works */}
      <Slide n="04" eyebrow="How it works">
        <div className="flex flex-col gap-8">
          <R>
            <h2 className="text-4xl font-semibold tracking-tight sm:text-6xl">
              Idea to first transaction, in minutes.
            </h2>
          </R>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { icon: Terminal, t: "Scaffold", d: "npm create avalanche-app@latest" },
              { icon: KeyRound, t: "Sign in", d: "Google login, no seed phrases (Web3Auth)" },
              {
                icon: Rocket,
                t: "Deploy",
                d: "Bundled bytecode → deploy from the browser on Fuji",
              },
            ].map((s, i) => (
              <R key={s.t} i={i}>
                <Card className="flex h-full flex-col gap-3 border-white/10 bg-white/[0.03] p-6">
                  <div className="flex items-center gap-3">
                    <span className="text-primary font-mono text-sm">0{i + 1}</span>
                    <s.icon className="size-4 text-white/70" />
                  </div>
                  <div className="text-lg font-medium">{s.t}</div>
                  <div className="text-sm text-white/50">{s.d}</div>
                </Card>
              </R>
            ))}
          </div>
          <R i={3}>
            <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/60 p-5 font-mono text-sm text-white/80">
              {`$ npm create avalanche-app@latest my-app
✓ template · nft-mint   ✓ wallet · social login
✓ created 16 files      ✓ deployed on Fuji  (tx 0x9a1f…8e090)`}
            </pre>
          </R>
        </div>
      </Slide>

      {/* 05 — AI-native wedge */}
      <Slide n="05" eyebrow="The wedge">
        <div className="flex flex-col gap-8">
          <R>
            <Badge variant="outline" className="w-fit border-primary/40 text-primary">
              AI-native by default
            </Badge>
          </R>
          <R i={1}>
            <h2 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              Let your agent build on Avalanche.
            </h2>
          </R>
          <R i={2}>
            <p className="max-w-3xl text-lg text-white/60 sm:text-xl">
              Every scaffolded app ships <span className="text-white">CLAUDE.md</span>,{" "}
              <span className="text-white">llms.txt</span>, and{" "}
              <span className="text-white">.cursor rules</span>. And{" "}
              <span className="text-primary">@avakit/mcp</span> exposes actions — not just docs — so
              Claude Code and Cursor can scaffold, deploy, and read chain state for you.
            </p>
          </R>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              "scaffold_app",
              "deploy_contract (mainnet guardrails)",
              "read_chain / get_context",
            ].map((t, i) => (
              <R key={t} i={i + 3}>
                <Card className="flex items-center gap-2 border-white/10 bg-white/[0.03] p-4 font-mono text-sm text-white/70">
                  <Sparkles className="text-primary size-4 shrink-0" />
                  {t}
                </Card>
              </R>
            ))}
          </div>
        </div>
      </Slide>

      {/* 06 — Product / templates */}
      <Slide n="06" eyebrow="The product">
        <div className="flex flex-col gap-8">
          <R>
            <h2 className="text-4xl font-semibold tracking-tight sm:text-6xl">
              Eight templates, from a first tx to your own L1.
            </h2>
          </R>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TEMPLATES.map((t, i) => (
              <R key={t.id} i={i}>
                <Card className="flex flex-col overflow-hidden border-white/10 bg-white/[0.03]">
                  <div className="relative aspect-video bg-black">
                    <Image
                      src={t.art}
                      alt=""
                      fill
                      sizes="200px"
                      className="object-contain p-3 mix-blend-screen"
                    />
                  </div>
                  <div className="border-t border-white/10 p-3 font-mono text-xs text-white/70">
                    {t.id}
                  </div>
                </Card>
              </R>
            ))}
          </div>
        </div>
      </Slide>

      {/* 07 — Traction */}
      <Slide n="07" eyebrow="Traction">
        <div className="flex flex-col gap-10">
          <R>
            <h2 className="text-4xl font-semibold tracking-tight sm:text-6xl">
              Built, shipped, and proven live.
            </h2>
          </R>
          <div className="grid gap-4 sm:grid-cols-4">
            {METRICS.map((m, i) => (
              <R key={m.label} i={i}>
                <Card className="flex h-full flex-col gap-3 border-white/10 bg-white/[0.03] p-6">
                  <m.icon className="text-primary size-5" />
                  <div className="text-4xl font-semibold tracking-tight">{m.big}</div>
                  <div className="text-sm text-white/50">{m.label}</div>
                </Card>
              </R>
            ))}
          </div>
          <R i={4}>
            <div className="flex flex-wrap gap-3 text-sm text-white/60">
              {[
                "create-avalanche-app + @avakit/core · react · mcp · studio on npm",
                "live at avakit.dev (EN + TR)",
                "real Fuji deploy + mint (Snowtrace-verifiable)",
              ].map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2"
                >
                  <Check className="text-primary size-3.5" /> {t}
                </span>
              ))}
            </div>
          </R>
        </div>
      </Slide>

      {/* 08 — Ask + vision */}
      <Slide n="08" eyebrow="The ask">
        <div className="flex flex-col gap-8">
          <R>
            <h2 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              A grant turns a working toolkit into the default way to build on Avalanche.
            </h2>
          </R>
          <div className="grid gap-4 sm:grid-cols-2">
            <R i={1}>
              <Card className="flex h-full flex-col gap-3 border-white/10 bg-white/[0.03] p-6">
                <div className="text-primary font-mono text-xs tracking-[0.2em] uppercase">
                  What it funds
                </div>
                <ul className="flex flex-col gap-2 text-white/70">
                  {[
                    "Newcomer DX: no-funds/faucet & error states, wallet-install flow",
                    "Deeper docs, examples, and video walkthroughs",
                    "Community support, hackathon starter, more Avalanche flows",
                  ].map((t) => (
                    <li key={t} className="flex gap-2">
                      <ArrowLeftRight className="text-primary mt-1 size-3.5 shrink-0" />
                      {t}
                    </li>
                  ))}
                </ul>
              </Card>
            </R>
            <R i={2}>
              <Card className="flex h-full flex-col gap-3 border-white/10 bg-white/[0.03] p-6">
                <div className="text-primary font-mono text-xs tracking-[0.2em] uppercase">
                  Where it goes
                </div>
                <ul className="flex flex-col gap-2 text-white/70">
                  {[
                    "Own-your-UI component library on shadcn primitives",
                    "More one-command L1 / ICM / ICTT flows",
                    "The road to a stable 1.0",
                  ].map((t) => (
                    <li key={t} className="flex gap-2">
                      <Coins className="text-primary mt-1 size-3.5 shrink-0" />
                      {t}
                    </li>
                  ))}
                </ul>
              </Card>
            </R>
          </div>
          <R i={3}>
            <div className="flex items-center gap-3 pt-2">
              <Image
                src="/logo.png"
                alt=""
                width={582}
                height={653}
                className="h-6 w-auto invert"
              />
              <span className="font-mono text-sm tracking-[0.3em] text-white/50 uppercase">
                avakit.dev · open source · MIT
              </span>
            </div>
          </R>
        </div>
      </Slide>
    </main>
  );
}
