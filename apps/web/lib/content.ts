import {
  ArrowLeftRight,
  Bot,
  Boxes,
  Coins,
  EyeOff,
  Frame,
  LayoutDashboard,
  Lock,
  Palette,
  Rocket,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wallet,
} from "lucide-react";

export type Locale = "en" | "tr";

// Production origin — invariant, used by robots / sitemap / metadata / JSON-LD.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://avakit.dev";
export const site = {
  name: "AvaKit",
  url: SITE_URL,
  github: "https://github.com/mericcintosun/AvaKit",
  githubDocs: "https://github.com/mericcintosun/AvaKit/tree/main/docs",
  npm: "https://www.npmjs.com/search?q=%40avakit",
};

// Language-invariant command shown across the site.
const CREATE_COMMAND = "npm create avalanche-app@latest";

// YouTube video ID for the "how to use" walkthrough. Leave empty to show a
// placeholder; set it (env or here) once the tutorial is recorded to embed it.
export const TUTORIAL_VIDEO_ID = process.env.NEXT_PUBLIC_TUTORIAL_VIDEO_ID ?? "";

// Google Form for user feedback. Set NEXT_PUBLIC_FEEDBACK_FORM_URL to the form's
// share link (…/viewform). The floating feedback button opens it in a new tab.
export const FEEDBACK_FORM_URL =
  process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL ?? "https://forms.gle/xBEdJVszCUhZ4g5K6";

// Icons per surface / recommender goal — invariant across locales.
const SURFACE_ICONS = [Boxes, Wallet, Terminal, Bot, LayoutDashboard];
const FEATURE_ICONS = [Sparkles, Bot, Palette, Rocket, ShieldCheck, Boxes];
const GOAL_ICONS = [Wallet, Frame, Coins, Lock, EyeOff, Send, Rocket, ArrowLeftRight];
const TEMPLATE_META = [
  { id: "minimal", contracts: false, art: "/minimal.jpg" },
  { id: "nft-mint", contracts: true, art: "/nft-mint.jpg" },
  { id: "token-gated-app", contracts: true, art: "/token-gated.jpg" },
  { id: "erc20-token", contracts: true, art: "/erc-20.jpg" },
  { id: "icm-messenger", contracts: true, art: "/island.jpg" },
  { id: "eerc-token", contracts: false, art: "/eERC.jpg" },
  { id: "l1-launch", contracts: true, art: "/l1.jpg" },
  { id: "token-bridge", contracts: false, art: "/ictt.jpg" },
];
// The recommender goal at index i maps to TEMPLATE_META[i]'s id.
const GOAL_TEMPLATE_IDS = [
  "minimal",
  "nft-mint",
  "erc20-token",
  "token-gated-app",
  "eerc-token",
  "icm-messenger",
  "l1-launch",
  "token-bridge",
];
// AvaKit column is highlighted; cells are invariant (the facts don't change by
// language). Columns: AvaKit · thirdweb · Official starter-kit · BuilderKit ·
// Embedded-wallet SaaS. thirdweb (multichain, AI + MCP too) is included so the
// table is honest — AvaKit is still the only all-✓ column.
const COMPARISON_CELLS = [
  [true, true, true, true, false], // open-source & free (WaaS is hosted, not FOSS)
  [true, true, false, false, false], // batteries-included scaffolder
  [true, true, false, false, true], // social-login by default
  [true, true, false, false, false], // AI-native (agent context + MCP)
  [true, false, false, false, false], // one core (SDK + widget + CLI + MCP + Studio)
  [true, false, false, false, false], // own your UI (copy-in shadcn, no lock-in)
];
const MCP_CONFIG = `{
  "mcpServers": {
    "avakit": {
      "command": "npx",
      "args": ["-y", "@avakit/mcp"]
    }
  }
}`;

type Strings = {
  tagline: string;
  description: string;
  nav: string[];
  header: { search: string; getStarted: string };
  hero: {
    badge: string;
    titleBefore: string;
    titleHighlight: string;
    ctaPrimary: string;
    ctaSecondary: string;
    terminal: string[];
  };
  surfacesSection: {
    eyebrow: string;
    title: string;
    lead: string;
    readDocs: string;
    onNpm: string;
  };
  surfaces: { name: string; tagline: string; points: string[] }[];
  featuresSection: { eyebrow: string; title: string; lead: string };
  features: { title: string; body: string }[];
  differentiation: {
    eyebrow: string;
    title: string;
    lead: string;
    note: string;
    columns: string[];
  };
  comparisonRows: string[];
  whoFor: { eyebrow: string; title: string; lead: string };
  audiences: { title: string; body: string }[];
  stepsSection: { eyebrow: string; title: string; lead: string };
  steps: { title: string; body: string; code: string }[];
  howTo: { eyebrow: string; title: string; lead: string; placeholder: string };
  templatesSection: { eyebrow: string; title: string; lead: string; all: string };
  templatesPage: { eyebrow: string; title: string; lead: string; more: string };
  templates: { title: string; description: string; highlights: string[] }[];
  recommender: {
    eyebrow: string;
    title: string;
    lead: string;
    recommended: string;
    seeAll: string;
    goals: string[];
  };
  mcp: {
    eyebrow: string;
    title: string;
    lead: string;
    add: string;
    headTool: string;
    headDoes: string;
    tools: string[];
    cta: string;
    advanced: string;
    beginner: string;
  };
  mcpToolNames: string[];
  faq: { eyebrow: string; title: string; items: { q: string; a: string }[] };
  cta: { eyebrow: string; title: string; body: string; primary: string; secondary: string };
  footer: { tagline: string };
  cinematic: { line1: string; line2: string; introducing: string };
  feedback: string;
  ambient: { eyebrow: string; statement: string };
};

const EN: Strings = {
  tagline: "The open-source, AI-native devtools for Avalanche.",
  description:
    "Scaffold a deploy-ready, social-login dapp with agent context baked in. One core, four surfaces. No seed phrases, no boilerplate.",
  nav: ["Docs", "Templates", "MCP", "AvaKit Studio"],
  header: { search: "Search", getStarted: "Get started" },
  hero: {
    badge: "Open source · AI-native · MIT",
    titleBefore: "The developer toolkit for building on",
    titleHighlight: "Avalanche",
    ctaPrimary: "Get started",
    ctaSecondary: "Browse templates",
    terminal: [
      "Template · nft-mint",
      "Wallet · social login (Web3Auth)",
      "Chain · Avalanche Fuji",
      "Created 16 files",
      "Installed dependencies",
      "cd my-app && pnpm dev",
      "Local: http://localhost:3000",
    ],
  },
  surfacesSection: {
    eyebrow: "Architecture",
    title: "One core, four surfaces",
    lead: "A single framework-agnostic kernel, delivered through the surface that fits how you work.",
    readDocs: "Read docs",
    onNpm: "All five packages on npm",
  },
  surfaces: [
    {
      name: "@avakit/core",
      tagline: "Framework-agnostic kernel",
      points: [
        "viem clients for Fuji, C-Chain, and custom L1s",
        "Wallet adapters (social login + injected)",
        "Deploy helpers and read-only chain data",
      ],
    },
    {
      name: "@avakit/react",
      tagline: "Drop-in wallet UI + hooks",
      points: [
        "<ConnectAvalanche /> social-login button",
        "Hooks: useAvaAccount, useBalance, useContract…",
        "Built on shadcn/ui, auto chain-switching",
      ],
    },
    {
      name: "create-avalanche-app",
      tagline: "Batteries-included scaffolder",
      points: [
        "One command → a working, deploy-ready dapp",
        "Templates for wallets, NFTs, token-gating",
        "Ships CLAUDE.md / llms.txt / .cursor rules",
      ],
    },
    {
      name: "@avakit/mcp",
      tagline: "AI agent interface",
      points: [
        "Scaffold + deploy from Claude Code / Cursor",
        "Read chain state over natural language",
        "Testnet-first with mainnet guardrails",
      ],
    },
    {
      name: "@avakit/studio",
      tagline: "Local dev dashboard",
      points: [
        "Spin up local L1s with Interchain Messaging",
        "Send cross-chain messages, inspect on-chain data",
        "Also an MCP server, so an agent can drive it",
      ],
    },
  ],
  featuresSection: {
    eyebrow: "Why AvaKit",
    title: "Everything you need, nothing you don't",
    lead: "The boring parts (onboarding, wallets, chain switching, deploy) handled with safe defaults.",
  },
  features: [
    {
      title: "Social-login onboarding",
      body: "Users sign in with Google. No seed phrases. Web3Auth keeps the HSM-backed keys; AvaKit never touches them.",
    },
    {
      title: "AI-native by default",
      body: "Every generated app ships with agent context, and the MCP server lets Claude / Cursor scaffold and deploy for you.",
    },
    {
      title: "shadcn/ui, themed",
      body: "A clean, accessible design system with dark/light wired from day one. Own your components; no vendor lock-in.",
    },
    {
      title: "Deploy-ready",
      body: "Contracts compile to bundled bytecode so you can deploy straight from the browser. Fuji by default.",
    },
    {
      title: "Safe defaults",
      body: "Testnet-first, mainnet is explicit opt-in, secrets stay in env, and keys live in the wallet provider.",
    },
    {
      title: "Wrap, don't rewrite",
      body: "AvaKit builds on viem, wagmi patterns, Web3Auth, and Foundry: mature pieces, packaged for a great DX.",
    },
  ],
  differentiation: {
    eyebrow: "Why AvaKit",
    title: "The only one that combines it all",
    lead: "Every piece exists somewhere: a starter kit here, a wallet SDK there, an AI tool elsewhere. AvaKit is the open-source toolkit that brings them together — Avalanche-native, with code you own and no vendor lock-in.",
    note: "thirdweb = multichain SDK/CLI (great, but not Avalanche-specific; prebuilt clientId-gated UI) · Official starter-kit = ava-labs/avalanche-starter-kit · BuilderKit = ava-labs/builderkit · Embedded-wallet SaaS = AvaCloud WaaS / hosted providers.",
    columns: ["AvaKit", "thirdweb", "Official starter-kit", "BuilderKit", "Embedded-wallet SaaS"],
  },
  comparisonRows: [
    "Open-source & free",
    "Batteries-included scaffolder",
    "Social-login onboarding by default",
    "AI-native: agent context + MCP actions",
    "One core: SDK + widget + CLI + MCP + Studio",
    "Own your UI: copy-in shadcn, no lock-in",
  ],
  whoFor: {
    eyebrow: "Who it's for",
    title: "Built for how people ship today",
    lead: "Seedless wallets already solved end-user onboarding: Core and WaaS handle keys with HSMs. Developer onboarding never got the same treatment, and now agents write most of the boilerplate. AvaKit is the open-source, AI-native layer that closes the gap: one command, or one prompt, to a real Avalanche dapp.",
  },
  audiences: [
    {
      title: "AI-first & vibe coders",
      body: "Describe what you want and let Claude Code or Cursor scaffold, wire, and deploy it through the MCP. Actions, not just docs.",
    },
    {
      title: "Hackathon & weekend builders",
      body: "From one npm command to a deployed, social-login dapp on Fuji in minutes. No seed phrases, no boilerplate, no chain-config spelunking.",
    },
    {
      title: "Teams onboarding to Avalanche",
      body: "A production-shaped starting point (wallets, chain-switching, deploy, plus L1 and Interchain tooling) with safe, testnet-first defaults.",
    },
  ],
  stepsSection: {
    eyebrow: "How it works",
    title: "From zero to first transaction",
    lead: "Three steps. No seed phrases, no boilerplate, no chain-config spelunking.",
  },
  steps: [
    {
      title: "Scaffold",
      body: "Run one command, or ask an AI agent. Pick from eight templates: a wallet, an NFT mint, a confidential token, your own L1, a cross-chain bridge, and more.",
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
  ],
  howTo: {
    eyebrow: "Watch first",
    title: "See it, start to finish",
    lead: "New to this? A short, zero-to-dapp walkthrough: run one command, sign in with Google, deploy and mint on Fuji. No prior web3 experience needed.",
    placeholder: "Walkthrough video coming soon",
  },
  templatesSection: {
    eyebrow: "Templates",
    title: "Start from a working example",
    lead: "Real, deploy-ready dapps with a social-login wallet and AI context baked in.",
    all: "All templates",
  },
  templatesPage: {
    eyebrow: "Templates",
    title: "Start from a working example",
    lead: "Every template is a real, deploy-ready dapp: shadcn/ui, a social-login wallet, dark/light from day one, and AI context files so Claude and Cursor understand it out of the box.",
    more: "More templates are on the way. Want one? Contributions welcome: every template is just a folder under templates/ with a manifest.",
  },
  templates: [
    {
      title: "Minimal",
      description:
        "The smallest real dapp: connect a wallet, read your balance, send a transaction.",
      highlights: [
        "Social-login + injected wallet",
        "Balance + first transaction",
        "Perfect starting point",
      ],
    },
    {
      title: "NFT mint",
      description:
        "Deploy an ERC-721 straight from the browser, then mint. No Foundry required to run it.",
      highlights: [
        "Self-contained ERC-721",
        "Bundled bytecode → browser deploy",
        "Mint + on-chain reads",
      ],
    },
    {
      title: "Token-gated app",
      description:
        "Unlock content for holders of an access-pass NFT. Deploy, mint, and the gate opens.",
      highlights: [
        "Ownership-based content lock",
        "Reusable access-pass NFT",
        "Security notes included",
      ],
    },
    {
      title: "ERC-20 token",
      description: "Deploy your own ERC-20 from the browser, mint supply, and transfer.",
      highlights: [
        "Self-contained ERC-20 (18 decimals)",
        "Deploy + mint + transfer",
        "parseUnits / formatUnits helpers",
      ],
    },
    {
      title: "ICM cross-chain messenger",
      description:
        "Send a message between two Avalanche L1s with Interchain Messaging, over a one-command local devnet.",
      highlights: [
        "One command: 2 local L1s + ICM + relayer",
        "Teleporter send + receive contract",
        "Watch a message cross chains live",
      ],
    },
    {
      title: "Confidential token (eERC)",
      description:
        "Register, mint, and privately transfer tokens with hidden balances using Avalanche's Encrypted ERC standard.",
      highlights: [
        "Zero-knowledge proofs, generated in the browser",
        "Hidden balances and transfer amounts",
        "Built on the official @avalabs/eerc-sdk",
      ],
    },
    {
      title: "Launch your own L1",
      description:
        "Spin up your own Avalanche L1 with one command, then explore blocks, send transactions, and deploy a contract in a built-in dashboard.",
      highlights: [
        "One command → your own Subnet-EVM chain",
        "Built-in block explorer (no Docker, no indexer)",
        "Graduate to Fuji when you're ready",
      ],
    },
    {
      title: "Cross-chain token bridge (ICTT)",
      description:
        "Bridge an ERC-20 between two Avalanche L1s with Interchain Token Transfer, over a one-command local devnet.",
      highlights: [
        "One command: 2 L1s + relayer + a full ICTT bridge",
        "Lock on one chain, mint on the other, then back",
        "Real Home/Remote contracts from ava-labs/icm-contracts",
      ],
    },
  ],
  recommender: {
    eyebrow: "Find your starting point",
    title: "What are you building?",
    lead: "Pick a goal. We'll point you at the right template and the exact command to run.",
    recommended: "Recommended",
    seeAll: "See all templates",
    goals: [
      "Add social login, no seed phrases",
      "Mint NFTs from the browser",
      "Launch my own token",
      "Gate content to holders",
      "Issue a confidential token",
      "Send cross-chain messages",
      "Launch my own L1",
      "Bridge tokens across L1s",
    ],
  },
  mcp: {
    eyebrow: "AI-native",
    title: "Let your agent build on Avalanche",
    lead: "@avakit/mcp exposes actions, not just docs, to Claude Code and Cursor. Ask in natural language.",
    add: "Add it to your MCP client:",
    headTool: "Tool",
    headDoes: "Does",
    tools: [
      "Create an Avalanche dapp from a template.",
      "List available templates.",
      "Read a balance, a tx receipt, or a contract view function.",
      "Deploy compiled bytecode. Fuji by default; mainnet needs confirmation.",
      "AvaKit + Avalanche coding context and doc links.",
    ],
    cta: "Set up the MCP server",
    advanced: "Advanced · for Claude Code / Cursor users",
    beginner:
      "New here? You don't need this. Start with the one-command scaffold above (or watch the walkthrough). MCP is an optional power-up once you already build with Claude Code or Cursor — it needs a config file, not a chat message.",
  },
  mcpToolNames: ["scaffold_app", "list_templates", "read_chain", "deploy_contract", "get_context"],
  faq: {
    eyebrow: "FAQ",
    title: "Questions, answered",
    items: [
      {
        q: "Do my users need a seed phrase?",
        a: "No. AvaKit defaults to social login (Google/Apple/email) via Web3Auth. Keys are HSM-backed and never pass through AvaKit. Browser wallets like Core and MetaMask work too.",
      },
      {
        q: "Is it locked to a specific wallet or provider?",
        a: "No. Wallet providers sit behind an adapter interface, so you can swap Web3Auth for AvaCloud, injected, or your own. Components are copy-in shadcn, so there's no vendor lock-in.",
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
        a: "AvaKit is pre-1.0. The core, React layer, scaffolder, MCP, and Studio are built, published, and verified live on Fuji; APIs may still change before 1.0.",
      },
    ],
  },
  cta: {
    eyebrow: "Ship today",
    title: "Your first Avalanche dapp is one command away",
    body: "Open source, MIT licensed, free. No seed phrases, no boilerplate.",
    primary: "Get started",
    secondary: "Browse templates",
  },
  footer: { tagline: "The open-source, AI‑native developer toolkit for Avalanche." },
  cinematic: {
    line1: "Next.js, but for Avalanche.",
    line2: "One command. A live dapp.",
    introducing: "Introducing",
  },
  feedback: "Feedback",
  ambient: {
    eyebrow: "One toolkit, every surface",
    statement: "Wallets, contracts, and AI on one consistent core.",
  },
};

const TR: Strings = {
  tagline: "Avalanche için açık kaynak, AI-native geliştirici araçları.",
  description:
    "Sosyal-girişli, deploy'a hazır bir dapp'i tek komutla kur; AI ajan bağlamı gömülü gelir. Tek çekirdek, dört yüzey. Seed phrase yok, boilerplate yok.",
  nav: ["Dokümanlar", "Şablonlar", "MCP", "AvaKit Studio"],
  header: { search: "Ara", getStarted: "Başla" },
  hero: {
    badge: "Açık kaynak · AI-native · MIT",
    titleBefore: "Şunun üzerine inşa etmek için geliştirici araç seti:",
    titleHighlight: "Avalanche",
    ctaPrimary: "Başla",
    ctaSecondary: "Şablonlara göz at",
    terminal: [
      "Şablon · nft-mint",
      "Cüzdan · sosyal giriş (Web3Auth)",
      "Zincir · Avalanche Fuji",
      "16 dosya oluşturuldu",
      "Bağımlılıklar kuruldu",
      "cd my-app && pnpm dev",
      "Yerel: http://localhost:3000",
    ],
  },
  surfacesSection: {
    eyebrow: "Mimari",
    title: "Tek çekirdek, dört yüzey",
    lead: "Tek, framework-bağımsız bir çekirdek; sana en uygun yüzeyden sunulur.",
    readDocs: "Dokümanları oku",
    onNpm: "Beş paketin tümü npm'de",
  },
  surfaces: [
    {
      name: "@avakit/core",
      tagline: "Framework-bağımsız çekirdek",
      points: [
        "Fuji, C-Chain ve özel L1'ler için viem client'ları",
        "Cüzdan adaptörleri (sosyal giriş + injected)",
        "Deploy yardımcıları ve salt-okunur zincir verisi",
      ],
    },
    {
      name: "@avakit/react",
      tagline: "Hazır cüzdan arayüzü + hook'lar",
      points: [
        "<ConnectAvalanche /> sosyal-giriş butonu",
        "Hook'lar: useAvaAccount, useBalance, useContract…",
        "shadcn/ui üzerine, otomatik zincir değişimi",
      ],
    },
    {
      name: "create-avalanche-app",
      tagline: "Her şey dahil scaffolder",
      points: [
        "Tek komut → çalışan, deploy'a hazır dapp",
        "Cüzdan, NFT, token-gating şablonları",
        "CLAUDE.md / llms.txt / .cursor kuralları ile gelir",
      ],
    },
    {
      name: "@avakit/mcp",
      tagline: "AI ajan arayüzü",
      points: [
        "Claude Code / Cursor'dan scaffold + deploy",
        "Zincir durumunu doğal dille oku",
        "Testnet-öncelikli, mainnet için koruma",
      ],
    },
    {
      name: "@avakit/studio",
      tagline: "Yerel geliştirme paneli",
      points: [
        "Interchain Messaging ile yerel L1'ler başlat",
        "Zincirler arası mesaj gönder, zincir verisini incele",
        "Aynı zamanda bir MCP sunucusu; bir ajandan yönetilebilir",
      ],
    },
  ],
  featuresSection: {
    eyebrow: "Neden AvaKit",
    title: "İhtiyacın olan her şey, fazlası değil",
    lead: "Sıkıcı kısımlar (onboarding, cüzdanlar, zincir değişimi, deploy) güvenli varsayılanlarla halledilir.",
  },
  features: [
    {
      title: "Sosyal-girişli onboarding",
      body: "Kullanıcılar Google ile giriş yapar; seed phrase yok. Anahtarlar Web3Auth'un HSM-destekli sisteminde durur; AvaKit onlara asla dokunmaz.",
    },
    {
      title: "Varsayılan olarak AI-native",
      body: "Üretilen her uygulama ajan bağlamıyla gelir; MCP sunucusu Claude / Cursor'ın senin yerine scaffold ve deploy yapmasını sağlar.",
    },
    {
      title: "shadcn/ui, temalı",
      body: "İlk günden dark/light bağlı, temiz ve erişilebilir bir tasarım sistemi. Bileşenler senindir; sağlayıcıya bağımlılık yok.",
    },
    {
      title: "Deploy'a hazır",
      body: "Kontratlar gömülü bytecode'a derlenir; doğrudan tarayıcıdan deploy edersin. Varsayılan Fuji.",
    },
    {
      title: "Güvenli varsayılanlar",
      body: "Testnet-öncelikli, mainnet açık onayla, sırlar env'de kalır, anahtarlar cüzdan sağlayıcısında yaşar.",
    },
    {
      title: "Sar, yeniden yazma",
      body: "AvaKit viem, wagmi kalıpları, Web3Auth ve Foundry üzerine kurulur: olgun parçalar, harika bir geliştirici deneyimi için paketlenmiş.",
    },
  ],
  differentiation: {
    eyebrow: "Neden AvaKit",
    title: "Hepsini birleştiren tek araç",
    lead: "Her parça bir yerlerde var: burada bir starter kit, orada bir cüzdan SDK'sı, başka yerde bir AI aracı. AvaKit bunları bir araya getirir — Avalanche'e özgü, kodunu sen sahiplenirsin, sağlayıcı kilidi yok.",
    note: "thirdweb = çok-zincirli SDK/CLI (harika ama Avalanche'e özgü değil; hazır, clientId'e bağlı UI) · Resmi starter-kit = ava-labs/avalanche-starter-kit · BuilderKit = ava-labs/builderkit · Gömülü-cüzdan SaaS = AvaCloud WaaS / barındırılan sağlayıcılar.",
    columns: ["AvaKit", "thirdweb", "Resmi starter-kit", "BuilderKit", "Gömülü-cüzdan SaaS"],
  },
  comparisonRows: [
    "Açık kaynak & ücretsiz",
    "Her şey dahil scaffolder",
    "Varsayılan sosyal-girişli onboarding",
    "AI-native: ajan bağlamı + MCP eylemleri",
    "Tek çekirdek: SDK + widget + CLI + MCP + Studio",
    "Arayüz senin: kopyala-gel shadcn, bağımlılık yok",
  ],
  whoFor: {
    eyebrow: "Kimin için",
    title: "İnsanların bugün geliştirdiği şekle göre tasarlandı",
    lead: "Seedless cüzdanlar son-kullanıcı onboarding'ini çoktan çözdü: Core ve WaaS anahtarları HSM'lerle yönetiyor. Geliştirici onboarding'i aynı ilgiyi hiç görmedi ve artık boilerplate'in çoğunu ajanlar yazıyor. AvaKit bu boşluğu kapatan açık kaynak, AI-native katmandır: tek komut ya da tek prompt ile gerçek bir Avalanche dapp'i.",
  },
  audiences: [
    {
      title: "AI-öncelikli & vibe coder'lar",
      body: "Ne istediğini anlat; Claude Code veya Cursor MCP üzerinden scaffold etsin, bağlasın ve deploy etsin. Sadece doküman değil, eylem.",
    },
    {
      title: "Hackathon & hafta sonu geliştiricileri",
      body: "Tek npm komutundan dakikalar içinde Fuji'de yayında, sosyal-girişli bir dapp'e. Seed phrase yok, boilerplate yok, zincir-config uğraşı yok.",
    },
    {
      title: "Avalanche'e geçen ekipler",
      body: "Üretime yakın bir başlangıç noktası (cüzdanlar, zincir değişimi, deploy, üstüne L1 ve Interchain araçları), güvenli ve testnet-öncelikli varsayılanlarla.",
    },
  ],
  stepsSection: {
    eyebrow: "Nasıl çalışır",
    title: "Sıfırdan ilk işleme",
    lead: "Üç adım. Seed phrase yok, boilerplate yok, zincir-config uğraşı yok.",
  },
  steps: [
    {
      title: "Kur",
      body: "Tek komut çalıştır (veya bir AI ajanına sor). Sekiz şablondan seç: bir cüzdan, bir NFT mint, gizli bir token, kendi L1'in, zincirler-arası bir köprü ve dahası.",
      code: "npm create avalanche-app@latest my-app",
    },
    {
      title: "Bağlan",
      body: "<ConnectAvalanche /> ekle. Kullanıcılar sosyal giriş veya tarayıcı cüzdanıyla girer; AvaKit onları doğru zincire geçirir.",
      code: "<ConnectAvalanche />",
    },
    {
      title: "Yayınla",
      body: "Kontratları tarayıcıdan deploy et, bakiyeleri hook'larla oku ve fikirden ilk işleme dakikalar içinde ulaş.",
      code: "pnpm dev  →  http://localhost:3000",
    },
  ],
  howTo: {
    eyebrow: "Önce izle",
    title: "Baştan sona, gözünle gör",
    lead: "Yeni misin? Sıfırdan dapp'e kısa bir anlatım: tek komut çalıştır, Google ile giriş yap, Fuji'de deploy edip mint et. Önceden web3 deneyimi gerekmez.",
    placeholder: "Anlatım videosu yakında",
  },
  templatesSection: {
    eyebrow: "Şablonlar",
    title: "Çalışan bir örnekten başla",
    lead: "Sosyal-girişli cüzdan ve AI bağlamı gömülü, gerçek ve deploy'a hazır dapp'ler.",
    all: "Tüm şablonlar",
  },
  templatesPage: {
    eyebrow: "Şablonlar",
    title: "Çalışan bir örnekten başla",
    lead: "Her şablon gerçek, deploy'a hazır bir dapp'tir: shadcn/ui, sosyal-girişli cüzdan, ilk günden dark/light ve Claude ile Cursor'ın kutudan anlaması için AI bağlam dosyaları.",
    more: "Daha fazla şablon yolda. Bir tane mi istiyorsun? Katkılar açık: her şablon templates/ altında bir manifest içeren bir klasörden ibaret.",
  },
  templates: [
    {
      title: "Minimal",
      description: "En küçük gerçek dapp: cüzdan bağla, bakiyeni oku, bir işlem gönder.",
      highlights: [
        "Sosyal-giriş + injected cüzdan",
        "Bakiye + ilk işlem",
        "Mükemmel başlangıç noktası",
      ],
    },
    {
      title: "NFT mint",
      description:
        "Doğrudan tarayıcıdan bir ERC-721 deploy et, sonra mint et. Çalıştırmak için Foundry gerekmez.",
      highlights: [
        "Bağımsız ERC-721",
        "Gömülü bytecode → tarayıcıdan deploy",
        "Mint + zincir okuması",
      ],
    },
    {
      title: "Token-gated uygulama",
      description:
        "Bir erişim-geçişi NFT'sine sahip olanlara içerik aç. Deploy et, mint et, kapı açılsın.",
      highlights: [
        "Sahiplik-tabanlı içerik kilidi",
        "Yeniden kullanılabilir erişim-geçişi NFT'si",
        "Güvenlik notları dahil",
      ],
    },
    {
      title: "ERC-20 token",
      description: "Kendi ERC-20'ni tarayıcıdan deploy et, arz bas ve transfer et.",
      highlights: [
        "Bağımsız ERC-20 (18 ondalık)",
        "Deploy + mint + transfer",
        "parseUnits / formatUnits yardımcıları",
      ],
    },
    {
      title: "ICM zincirler-arası mesajlaşma",
      description:
        "Interchain Messaging ile iki Avalanche L1'i arasında mesaj gönder; tek komutluk yerel devnet üzerinde.",
      highlights: [
        "Tek komut: 2 yerel L1 + ICM + relayer",
        "Teleporter gönder + al kontratı",
        "Bir mesajın zincirleri canlı geçişini izle",
      ],
    },
    {
      title: "Gizli token (eERC)",
      description:
        "Avalanche'in Encrypted ERC standardıyla gizli bakiyeler kullanarak token kaydet, bas ve özel olarak transfer et.",
      highlights: [
        "Tarayıcıda üretilen sıfır-bilgi kanıtları",
        "Gizli bakiyeler ve transfer tutarları",
        "Resmi @avalabs/eerc-sdk üzerine kurulu",
      ],
    },
    {
      title: "Kendi L1'ini başlat",
      description:
        "Tek komutla kendi Avalanche L1'ini başlat; sonra blokları keşfet, işlem gönder ve gömülü bir panelde kontrat deploy et.",
      highlights: [
        "Tek komut → kendi Subnet-EVM zincirin",
        "Gömülü blok gezgini (Docker yok, indexer yok)",
        "Hazır olunca Fuji'ye geç",
      ],
    },
    {
      title: "Zincirler-arası token köprüsü (ICTT)",
      description:
        "Interchain Token Transfer ile iki Avalanche L1'i arasında bir ERC-20 köprüle; tek komutluk yerel devnet üzerinde.",
      highlights: [
        "Tek komut: 2 L1 + relayer + tam ICTT köprüsü",
        "Bir zincirde kilitle, diğerinde bas, sonra geri getir",
        "ava-labs/icm-contracts'tan gerçek Home/Remote kontratları",
      ],
    },
  ],
  recommender: {
    eyebrow: "Başlangıç noktanı bul",
    title: "Ne inşa ediyorsun?",
    lead: "Bir hedef seç: doğru şablonu ve çalıştıracağın tam komutu gösterelim.",
    recommended: "Önerilen",
    seeAll: "Tüm şablonları gör",
    goals: [
      "Sosyal giriş ekle, seed phrase yok",
      "Tarayıcıdan NFT mint et",
      "Kendi token'ımı çıkar",
      "İçeriği sahiplere kilitle",
      "Gizli bir token çıkar",
      "Zincirler-arası mesaj gönder",
      "Kendi L1'imi başlat",
      "L1'ler arası token köprüle",
    ],
  },
  mcp: {
    eyebrow: "AI-native",
    title: "Ajanın Avalanche üzerinde inşa etsin",
    lead: "@avakit/mcp, Claude Code ve Cursor'a sadece doküman değil eylemler sunar. Doğal dille iste.",
    add: "MCP istemcine ekle:",
    headTool: "Araç",
    headDoes: "Ne yapar",
    tools: [
      "Bir şablondan Avalanche dapp'i oluşturur.",
      "Mevcut şablonları listeler.",
      "Bir bakiye, işlem makbuzu veya kontrat view fonksiyonu okur.",
      "Derlenmiş bytecode deploy eder. Varsayılan Fuji; mainnet onay ister.",
      "AvaKit + Avalanche kodlama bağlamı ve doküman linkleri.",
    ],
    cta: "MCP sunucusunu kur",
    advanced: "İleri seviye · Claude Code / Cursor kullananlar için",
    beginner:
      "Yeni misin? Buna ihtiyacın yok. Yukarıdaki tek-komut scaffold ile başla (ya da anlatım videosunu izle). MCP, zaten Claude Code veya Cursor ile geliştirdiğinde işine yarayan opsiyonel bir güçlendirme — ve bir chat mesajına değil, bir config dosyasına eklenir.",
  },
  mcpToolNames: ["scaffold_app", "list_templates", "read_chain", "deploy_contract", "get_context"],
  faq: {
    eyebrow: "SSS",
    title: "Sorular, yanıtlandı",
    items: [
      {
        q: "Kullanıcılarımın seed phrase'e ihtiyacı var mı?",
        a: "Hayır. AvaKit varsayılan olarak Web3Auth ile sosyal giriş (Google/Apple/e-posta) kullanır. Anahtarlar HSM-destekli ve AvaKit'ten asla geçmez. Core ve MetaMask gibi tarayıcı cüzdanları da çalışır.",
      },
      {
        q: "Belirli bir cüzdana veya sağlayıcıya kilitli mi?",
        a: "Hayır. Cüzdan sağlayıcıları bir adaptör arayüzünün arkasında; Web3Auth'u AvaCloud, injected veya kendinkiyle değiştirebilirsin. Bileşenler kopyala-gel shadcn; sağlayıcıya bağımlılık yok.",
      },
      {
        q: "Hangi zincirler destekleniyor?",
        a: "Avalanche Fuji (testnet, varsayılan), C-Chain (mainnet, opsiyonel) ve defineChain ile herhangi bir özel EVM L1.",
      },
      {
        q: "Nasıl 'AI-native'?",
        a: "Scaffold edilen her uygulama CLAUDE.md, llms.txt ve .cursor kurallarıyla gelir; @avakit/mcp, Claude Code / Cursor'ın doğrudan scaffold, deploy ve zincir durumu okumasını sağlar.",
      },
      {
        q: "Üretime hazır mı?",
        a: "AvaKit 1.0 öncesi. Çekirdek, React katmanı, scaffolder, MCP ve Studio inşa edildi, yayınlandı ve Fuji'de canlı doğrulandı; API'ler 1.0'dan önce değişebilir.",
      },
    ],
  },
  cta: {
    eyebrow: "Bugün yayınla",
    title: "İlk Avalanche dapp'in tek komut uzağında",
    body: "Açık kaynak, MIT lisanslı, ücretsiz. Seed phrase yok, boilerplate yok.",
    primary: "Başla",
    secondary: "Şablonlara göz at",
  },
  footer: { tagline: "Avalanche için açık kaynak, AI‑native geliştirici araç seti." },
  cinematic: {
    line1: "Next.js, ama Avalanche için.",
    line2: "Tek komut. Canlı bir dapp.",
    introducing: "Karşınızda",
  },
  feedback: "Geri bildirim",
  ambient: {
    eyebrow: "Tek araç seti, her yüzey",
    statement: "Cüzdanlar, kontratlar ve AI; tek tutarlı çekirdek üzerinde.",
  },
};

const STRINGS: Record<Locale, Strings> = { en: EN, tr: TR };

export type Surface = {
  icon: (typeof SURFACE_ICONS)[number];
  slug: string;
  name: string;
  tagline: string;
  points: string[];
};
export type Template = {
  id: string;
  contracts: boolean;
  art: string;
  title: string;
  description: string;
  highlights: string[];
};

const SURFACE_SLUGS = ["core", "react", "cli", "mcp", "studio"];

export function getContent(locale: Locale) {
  const s = STRINGS[locale] ?? EN;
  return {
    site: { name: "AvaKit", url: SITE_URL, tagline: s.tagline, description: s.description },
    createCommand: CREATE_COMMAND,
    nav: s.nav.map((label, i) => ({
      label,
      href: ["/docs", "/templates", "/docs/mcp", "/docs/studio"][i],
    })),
    header: s.header,
    hero: s.hero,
    surfacesSection: s.surfacesSection,
    surfaces: s.surfaces.map((x, i) => ({
      icon: SURFACE_ICONS[i],
      slug: SURFACE_SLUGS[i],
      ...x,
    })) as Surface[],
    featuresSection: s.featuresSection,
    features: s.features.map((x, i) => ({ icon: FEATURE_ICONS[i], ...x })),
    differentiation: {
      ...s.differentiation,
      rows: s.comparisonRows.map((label, i) => ({ label, cells: COMPARISON_CELLS[i] })),
    },
    whoFor: s.whoFor,
    audiences: s.audiences,
    stepsSection: s.stepsSection,
    steps: s.steps,
    howTo: s.howTo,
    templatesSection: s.templatesSection,
    templatesPage: s.templatesPage,
    templates: s.templates.map((x, i) => ({ ...TEMPLATE_META[i], ...x })) as Template[],
    recommender: {
      ...s.recommender,
      goals: s.recommender.goals.map((label, i) => ({
        label,
        icon: GOAL_ICONS[i],
        templateId: GOAL_TEMPLATE_IDS[i],
      })),
    },
    mcp: {
      ...s.mcp,
      config: MCP_CONFIG,
      tools: s.mcpToolNames.map((name, i) => ({ name, description: s.mcp.tools[i] })),
    },
    faq: s.faq,
    cta: s.cta,
    footer: s.footer,
    cinematic: s.cinematic,
    feedback: s.feedback,
    ambient: s.ambient,
  };
}

export type Content = ReturnType<typeof getContent>;
