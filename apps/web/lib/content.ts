import { Bot, Boxes, Palette, Rocket, ShieldCheck, Sparkles, Terminal, Wallet } from "lucide-react";

export const site = {
  name: "AvaKit",
  tagline: "The open-source, AI-native devtools for Avalanche.",
  description:
    "Scaffold a social-login dapp, deploy-ready, with agent context baked in. One core, three surfaces — no seed phrases, no boilerplate.",
  createCommand: "npm create avalanche-app@latest",
};

export const nav = [
  { label: "Docs", href: "/docs" },
  { label: "Templates", href: "/templates" },
  { label: "MCP", href: "/docs/mcp" },
];

export type Surface = {
  icon: typeof Boxes;
  name: string;
  slug: string;
  tagline: string;
  points: string[];
};

export const surfaces: Surface[] = [
  {
    icon: Boxes,
    name: "@avakit/core",
    slug: "core",
    tagline: "Framework-agnostic kernel",
    points: [
      "viem clients for Fuji, C-Chain, and custom L1s",
      "Wallet adapters (social login + injected)",
      "Deploy helpers and read-only chain data",
    ],
  },
  {
    icon: Wallet,
    name: "@avakit/react",
    slug: "react",
    tagline: "Drop-in wallet UI + hooks",
    points: [
      "<ConnectAvalanche /> social-login button",
      "Hooks: useAvaAccount, useBalance, useContract…",
      "Built on shadcn/ui, auto chain-switching",
    ],
  },
  {
    icon: Terminal,
    name: "create-avalanche-app",
    slug: "cli",
    tagline: "Batteries-included scaffolder",
    points: [
      "One command → a working, deploy-ready dapp",
      "Templates for wallets, NFTs, token-gating",
      "Ships CLAUDE.md / llms.txt / .cursor rules",
    ],
  },
  {
    icon: Bot,
    name: "@avakit/mcp",
    slug: "mcp",
    tagline: "AI agent interface",
    points: [
      "Scaffold + deploy from Claude Code / Cursor",
      "Read chain state over natural language",
      "Testnet-first with mainnet guardrails",
    ],
  },
];

export type Feature = {
  icon: typeof Sparkles;
  title: string;
  body: string;
};

export const features: Feature[] = [
  {
    icon: Sparkles,
    title: "Social-login onboarding",
    body: "Users sign in with Google — no seed phrases. Powered by Web3Auth's HSM-backed keys; AvaKit never touches them.",
  },
  {
    icon: Bot,
    title: "AI-native by default",
    body: "Every generated app ships with agent context, and the MCP server lets Claude / Cursor scaffold and deploy for you.",
  },
  {
    icon: Palette,
    title: "shadcn/ui, themed",
    body: "A clean, accessible design system with dark/light wired from day one. Own your components — no vendor lock-in.",
  },
  {
    icon: Rocket,
    title: "Deploy-ready",
    body: "Contracts compile to bundled bytecode so you can deploy straight from the browser. Fuji by default.",
  },
  {
    icon: ShieldCheck,
    title: "Safe defaults",
    body: "Testnet-first, mainnet is explicit opt-in, secrets stay in env, and keys live in the wallet provider.",
  },
  {
    icon: Boxes,
    title: "Wrap, don't rewrite",
    body: "AvaKit builds on viem, wagmi patterns, Web3Auth, and Foundry — mature pieces, packaged for a great DX.",
  },
];

export const steps = [
  {
    title: "Scaffold",
    body: "Run one command (or ask an AI agent). Pick a template — minimal, NFT mint, or token-gated.",
    code: "npm create avalanche-app@latest my-app",
  },
  {
    title: "Connect",
    body: "Drop in <ConnectAvalanche />. Users sign in with social login or a browser wallet; AvaKit switches them to the right chain.",
    code: "<ConnectAvalanche />",
  },
  {
    title: "Ship",
    body: "Deploy contracts from the browser, read balances with hooks, and go from idea to first transaction in minutes.",
    code: "pnpm dev  →  http://localhost:3000",
  },
];

export type Template = {
  id: string;
  title: string;
  description: string;
  contracts: boolean;
  highlights: string[];
  art: string;
};

export const templates: Template[] = [
  {
    id: "minimal",
    title: "Minimal",
    description: "The smallest real dapp: connect a wallet, read your balance, send a transaction.",
    contracts: false,
    highlights: [
      "Social-login + injected wallet",
      "Balance + first transaction",
      "Perfect starting point",
    ],
    art: "/minimal.jpg",
  },
  {
    id: "nft-mint",
    title: "NFT mint",
    description:
      "Deploy an ERC-721 straight from the browser, then mint — no Foundry required to run it.",
    contracts: true,
    highlights: [
      "Self-contained ERC-721",
      "Bundled bytecode → browser deploy",
      "Mint + on-chain reads",
    ],
    art: "/nft-mint.jpg",
  },
  {
    id: "token-gated-app",
    title: "Token-gated app",
    description:
      "Unlock content for holders of an access-pass NFT. Deploy, mint, and the gate opens.",
    contracts: true,
    highlights: [
      "Ownership-based content lock",
      "Reusable access-pass NFT",
      "Security notes included",
    ],
    art: "/token-gated.jpg",
  },
  {
    id: "erc20-token",
    title: "ERC-20 token",
    description: "Deploy your own ERC-20 from the browser, mint supply, and transfer.",
    contracts: true,
    highlights: [
      "Self-contained ERC-20 (18 decimals)",
      "Deploy + mint + transfer",
      "parseUnits / formatUnits helpers",
    ],
    art: "/erc-20.jpg",
  },
];

export type McpTool = {
  name: string;
  description: string;
};

export const mcpTools: McpTool[] = [
  { name: "scaffold_app", description: "Create an Avalanche dapp from a template." },
  { name: "list_templates", description: "List available templates." },
  { name: "read_chain", description: "Read a balance, a tx receipt, or a contract view function." },
  {
    name: "deploy_contract",
    description: "Deploy compiled bytecode — Fuji by default, mainnet needs confirm.",
  },
  { name: "get_context", description: "AvaKit + Avalanche coding context and doc links." },
];

export const faqs = [
  {
    q: "Do my users need a seed phrase?",
    a: "No. AvaKit defaults to social login (Google/Apple/email) via Web3Auth. Keys are HSM-backed and never pass through AvaKit. Browser wallets like Core and MetaMask work too.",
  },
  {
    q: "Is it locked to a specific wallet or provider?",
    a: "No. Wallet providers sit behind an adapter interface — swap Web3Auth for AvaCloud, injected, or your own. Components are copy-in shadcn; there's no vendor lock-in.",
  },
  {
    q: "What chains are supported?",
    a: "Avalanche Fuji (testnet, default), C-Chain (mainnet, opt-in), and any custom EVM L1 via defineChain.",
  },
  {
    q: "How is it 'AI-native'?",
    a: "Every scaffolded app ships CLAUDE.md, llms.txt and .cursor rules, and @avakit/mcp lets Claude Code / Cursor scaffold, deploy, and read chain state directly.",
  },
  {
    q: "Is it production-ready?",
    a: "AvaKit is pre-release (0.1.0). The core, React layer, scaffolder, and MCP are built and verified; APIs may still change before 1.0.",
  },
];
