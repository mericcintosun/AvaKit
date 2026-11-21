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

/**
 * The number in the "Created N files" line that `create-avalanche-app` prints
 * for the nft-mint template. The hero terminal, the /terminal replay and the
 * pitch deck all show that line, and all read the number from here.
 *
 * It is every file under packages/create-avalanche-app/templates/nft-mint
 * except manifest.json (which is not copied). Recount whenever that template
 * gains or loses a file:
 *
 *   find packages/create-avalanche-app/templates/nft-mint -type f ! -name manifest.json | wc -l
 */
export const NFT_MINT_FILE_COUNT = 22;

// The landing plays a muted, silent preview of the walkthrough (public/
// avakittutorial.mp4). This is the full, narrated version on YouTube — set the
// URL (env or here) to reveal a "Watch on YouTube" link under the preview.
export const TUTORIAL_YOUTUBE_URL =
  process.env.NEXT_PUBLIC_TUTORIAL_YOUTUBE_URL ?? "https://youtu.be/GeSpcrmIpnc";

// Google Form for user feedback. Set NEXT_PUBLIC_FEEDBACK_FORM_URL to the form's
// share link (…/viewform). The floating feedback button opens it in a new tab.
export const FEEDBACK_FORM_URL =
  process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL ?? "https://forms.gle/xBEdJVszCUhZ4g5K6";

// Icons per surface / recommender goal — invariant across locales.
const SURFACE_ICONS = [Boxes, Wallet, Terminal, Bot, LayoutDashboard];
const FEATURE_ICONS = [Sparkles, Bot, Palette, Rocket, ShieldCheck, Boxes];
const GOAL_ICONS = [Wallet, Frame, Coins, Lock, EyeOff, Send, Rocket, ArrowLeftRight];

/**
 * Where a template runs. "fuji": on the Fuji testnet, with nothing else to
 * install. "devnet": on a local devnet that the template's setup script starts
 * with Avalanche CLI.
 */
export type TemplateRunsOn = "fuji" | "devnet";

// Facts about each template that do not change by language. `contracts`,
// `runsOn`, `mainnet` and `experimental` mirror the template's manifest.json in
// packages/create-avalanche-app/templates (`contracts`, `setup`, whether
// `chains` lists "c-chain", and whether `status` is "experimental"); keep them
// in step with it.
const TEMPLATE_META: {
  id: string;
  contracts: boolean;
  art: string;
  runsOn: TemplateRunsOn;
  /** Whether `--chain c-chain` (mainnet) is accepted for this template. */
  mainnet: boolean;
  /** Whether the scaffolder labels it experimental and warns when it is chosen. */
  experimental: boolean;
}[] = [
  {
    id: "minimal",
    contracts: false,
    art: "/minimal.jpg",
    runsOn: "fuji",
    mainnet: true,
    experimental: false,
  },
  {
    id: "nft-mint",
    contracts: true,
    art: "/nft-mint.jpg",
    runsOn: "fuji",
    mainnet: false,
    experimental: false,
  },
  {
    id: "token-gated-app",
    contracts: true,
    art: "/token-gated.jpg",
    runsOn: "fuji",
    mainnet: false,
    experimental: false,
  },
  {
    id: "erc20-token",
    contracts: true,
    art: "/erc-20.jpg",
    runsOn: "fuji",
    mainnet: false,
    experimental: false,
  },
  {
    id: "icm-messenger",
    contracts: true,
    art: "/island.jpg",
    runsOn: "devnet",
    mainnet: false,
    experimental: true,
  },
  {
    id: "eerc-token",
    contracts: false,
    art: "/eERC.jpg",
    runsOn: "fuji",
    mainnet: false,
    experimental: false,
  },
  {
    id: "l1-launch",
    contracts: true,
    art: "/l1.jpg",
    runsOn: "devnet",
    mainnet: false,
    experimental: true,
  },
  {
    id: "token-bridge",
    contracts: false,
    art: "/ictt.jpg",
    runsOn: "devnet",
    mainnet: false,
    experimental: true,
  },
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
// The tools @avakit/mcp registers, in the order the docs list them. The
// descriptions in `mcp.tools` below are matched to these by position.
const MCP_TOOL_NAMES = [
  "scaffold_app",
  "list_templates",
  "read_chain",
  "estimate_gas",
  "deploy_contract",
  "write_contract",
  "wallet_status",
  "get_context",
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
  header: { search: string; getStarted: string; tryIt: string };
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
  // How AvaKit relates to the official Avalanche tools. Every cell is a
  // statement about a product, so each one has to be checked when it changes;
  // `note` carries the date they were last checked.
  differentiation: {
    eyebrow: string;
    title: string;
    lead: string;
    note: string;
    /** Header of the first column, which names what each row is about. */
    topic: string;
    columns: string[];
    /** One cell per column, in the same order as `columns`. */
    rows: { label: string; cells: string[] }[];
  };
  whoFor: { eyebrow: string; title: string; lead: string };
  audiences: { title: string; body: string }[];
  stepsSection: { eyebrow: string; title: string; lead: string };
  steps: { title: string; body: string; code: string }[];
  howTo: { eyebrow: string; title: string; lead: string; watchOnYoutube: string };
  templatesSection: { eyebrow: string; title: string; lead: string; all: string };
  templatesPage: {
    eyebrow: string;
    title: string;
    lead: string;
    more: string;
    /** Badge text for where a template runs. */
    runsOn: { fuji: string; fujiAndMainnet: string; devnet: string };
    /** Badge text on a template the scaffolder labels experimental. */
    experimental: string;
    /** Shown on every template that needs Avalanche CLI. */
    devnetNote: string;
  };
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
  faq: { eyebrow: string; title: string; items: { q: string; a: string }[] };
  cta: { eyebrow: string; title: string; body: string; primary: string; secondary: string };
  footer: { tagline: string };
  cinematic: { line1: string; line2: string; introducing: string };
  feedback: string;
  ambient: { eyebrow: string; statement: string };
};

const EN: Strings = {
  tagline: "Open-source, AI-native developer tools for Avalanche.",
  description:
    "Scaffold a working Avalanche dapp with one command: a temporary test wallet funded on Fuji, social login and browser wallets when you want them, and agent context baked in. One core, four surfaces.",
  nav: ["Docs", "Templates", "MCP", "AvaKit Studio"],
  header: { search: "Search", getStarted: "Get started", tryIt: "Try it now" },
  hero: {
    badge: "Open source · AI-native · MIT",
    titleBefore: "A developer toolkit for building on",
    titleHighlight: "Avalanche",
    ctaPrimary: "Get started",
    ctaSecondary: "Browse templates",
    // Mirrors what the CLI prints for nft-mint (see create-avalanche-app's
    // wizard): its three choices, its two checkmarks, then the next steps. The
    // package manager is npm because the command above them is `npm create`,
    // and the file count is NFT_MINT_FILE_COUNT (see there for how to recount).
    terminal: [
      "Template · NFT mint",
      "Network · Fuji testnet",
      "Package manager · npm",
      `Created ${NFT_MINT_FILE_COUNT} files`,
      "Dependencies installed",
      "cd my-app && npm run dev",
      "Local: http://localhost:3000",
    ],
  },
  surfacesSection: {
    eyebrow: "Architecture",
    title: "One core, five packages",
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
        "Wallet adapters: temporary wallet, social login, browser wallet",
        "Deploy helpers and read-only chain data",
      ],
    },
    {
      name: "@avakit/react",
      tagline: "Drop-in wallet UI + hooks",
      points: [
        "<ConnectAvalanche /> wallet button and chooser",
        "Hooks: useAvaAccount, useBalance, useContract…",
        "shadcn/ui styling, auto chain-switching",
      ],
    },
    {
      name: "create-avalanche-app",
      tagline: "One-command scaffolder",
      points: [
        "One command → a working dapp on the Fuji testnet",
        "Eight templates, from a first transaction to your own L1",
        "Ships CLAUDE.md / llms.txt / .cursor rules",
      ],
    },
    {
      name: "@avakit/mcp",
      tagline: "MCP server for coding agents",
      points: [
        "Scaffold, deploy and mint from Claude Code / Cursor",
        "Read chain state over natural language",
        "Fuji test wallet built in; mainnet double-gated",
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
    title: "The setup work, already done",
    lead: "The repetitive parts (wallets, test funds, chain switching, deploy) are handled with testnet-first defaults.",
  },
  features: [
    {
      title: "Start instantly",
      body: "In the Fuji templates the first choice is Start instantly: a temporary wallet that is created in the browser and funded from AvaKit's shared faucet, so a first transaction needs no extension, seed phrase or account. Social login (Web3Auth) and browser wallets (Core, MetaMask) are one click away, and their keys stay with the wallet provider.",
    },
    {
      title: "AI-native by default",
      body: "Every generated app ships agent context (CLAUDE.md, llms.txt, Cursor rules), and the MCP server lets Claude Code or Cursor scaffold, deploy and mint on Fuji for you.",
    },
    {
      title: "shadcn/ui, themed",
      body: "shadcn/ui styling with dark and light themes wired from day one. The app's own UI is plain code in your repo, in neutral grayscale and ready for your brand; the wallet button from @avakit/react follows the same theme tokens.",
    },
    {
      title: "Deploy from the browser",
      body: "Templates with a contract ship its compiled bytecode, so the app deploys from the browser with no Foundry install. Fuji by default.",
    },
    {
      title: "Safe defaults",
      body: "Testnet first. Mainnet is an explicit, guarded step, secrets stay in env, and a real wallet's keys never leave its wallet provider.",
    },
    {
      title: "Wrap, don't rewrite",
      body: "AvaKit builds on viem, Web3Auth and Foundry: mature pieces, wired together so they work out of the box.",
    },
  ],
  differentiation: {
    eyebrow: "In context",
    title: "Next to the official tools",
    lead: "Ava Labs' Builder Hub covers a lot: Studio, a hosted prompt-to-contract flow in the Console; a read-only MCP server; and the Fuji faucet. AvaKit is the local, open-source counterpart: it lives in your own folder and your own coding agent, and needs no account for a first Fuji transaction.",
    note: "Checked on 2026-11-18. The official tools change quickly; build.avax.network has their current state.",
    topic: "Topic",
    columns: ["AvaKit", "Official Avalanche tools (Builder Hub)"],
    rows: [
      {
        label: "Starting a new dapp",
        cells: [
          "npm create avalanche-app: an npm CLI that writes the project into your own folder.",
          "Studio in the Builder Hub Console: a hosted flow from a prompt to contracts, tests and a Fuji deployment. There is no official one-command create-app CLI on npm.",
        ],
      },
      {
        label: "Account for a first Fuji transaction",
        cells: [
          "None. A temporary test wallet is funded from AvaKit's shared, rate-limited faucet.",
          "A free Builder Hub sign-in, for Studio and for the official faucet.",
        ],
      },
      {
        label: "MCP server for coding agents",
        cells: [
          "Reads, and on the Fuji testnet also writes: it deploys a contract and sends a contract call, behind explicit gates.",
          "Read-only: it looks up documentation and on-chain data and never signs.",
        ],
      },
      {
        label: "Mainnet",
        cells: [
          "A separate, guarded step. Only the minimal template scaffolds for C-Chain, and the MCP server needs your own key and two opt-ins.",
          "A gated promotion step inside Studio.",
        ],
      },
      {
        label: "Who is behind it",
        cells: [
          "An independent open-source project (MIT) with one maintainer, pre-1.0.",
          "Ava Labs.",
        ],
      },
    ],
  },
  whoFor: {
    eyebrow: "Who it's for",
    title: "Built for how people ship today",
    lead: "Seedless wallets such as Core gave end users a way in without a seed phrase, and coding agents now write much of the boilerplate. AvaKit works on the developer's side of that: one command, or one prompt to your own coding agent, to a working Avalanche dapp on your machine.",
  },
  audiences: [
    {
      title: "AI-first & vibe coders",
      body: "Describe what you want and let Claude Code or Cursor scaffold the app, deploy its contract and mint on Fuji through the MCP server, with no key to set up.",
    },
    {
      title: "Hackathon & weekend builders",
      body: "From one npm command to an app that deploys and mints on Fuji in minutes. The first transaction needs no seed phrase, no account and no chain configuration.",
    },
    {
      title: "Teams onboarding to Avalanche",
      body: "A structured starting point: wallets, chain switching and deploy, plus local L1 and Interchain templates, with testnet-first defaults. It is pre-1.0, and mainnet is a separate, explicit step.",
    },
  ],
  stepsSection: {
    eyebrow: "How it works",
    title: "From zero to first transaction",
    lead: "Three steps. No seed phrase, no account and no chain configuration for the first transaction.",
  },
  steps: [
    {
      title: "Scaffold",
      body: "Run one command, or ask your coding agent. Pick from eight templates: a wallet, an NFT mint, a confidential token, your own L1, a cross-chain bridge, and more.",
      code: "npm create avalanche-app@latest my-app",
    },
    {
      title: "Start instantly",
      body: "Run the app and choose Start instantly. It creates a temporary wallet in your browser and, on Fuji, funds it from AvaKit's shared faucet. Social login and browser wallets are in the same dialog.",
      code: "cd my-app && npm run dev",
    },
    {
      title: "Deploy and mint",
      body: "Press Deploy, then Mint. The contract's bytecode ships with the app, so the browser sends both transactions and links the contract and the mint on the explorer. Your coding agent can do the same through the MCP server.",
      code: 'await deploy({ abi, bytecode });\nawait nft.write("mint", []);',
    },
  ],
  howTo: {
    eyebrow: "Watch first",
    title: "See it, start to finish",
    lead: "A short zero-to-dapp walkthrough, recorded in July 2026 on an earlier release: run one command, sign in with Google, deploy and mint on Fuji. Today the CLI no longer asks for a wallet, and the app offers a temporary wallet first, so you can skip the sign-in.",
    watchOnYoutube: "Watch the full walkthrough with sound on YouTube",
  },
  templatesSection: {
    eyebrow: "Templates",
    title: "Start from a working example",
    lead: "Working example apps with a wallet chooser and AI context files included.",
    all: "All templates",
  },
  templatesPage: {
    eyebrow: "Templates",
    title: "Start from a working example",
    lead: "Every template is a working app: shadcn/ui, a wallet chooser, dark and light themes, and AI context files for Claude Code and Cursor. Five run on the Fuji testnet; three run on a local devnet and need Avalanche CLI.",
    more: "Want another template? Contributions are welcome: each one is a folder with a manifest.json under packages/create-avalanche-app/templates.",
    runsOn: {
      fuji: "Fuji testnet",
      fujiAndMainnet: "Fuji testnet · C-Chain opt-in",
      devnet: "Local devnet · needs Avalanche CLI",
    },
    experimental: "Experimental",
    devnetNote:
      "Runs on a local devnet started by Avalanche CLI, which has been in maintenance mode since December 2025. Needs a Unix-like shell (macOS, Linux or WSL2). Last proven end to end in July 2026.",
  },
  templates: [
    {
      title: "Minimal",
      description:
        "The smallest real dapp: connect a wallet, read your balance, send a transaction.",
      highlights: [
        "Temporary wallet, social login, browser wallet",
        "Balance + first transaction",
        "The one template that also scaffolds for C-Chain mainnet",
      ],
    },
    {
      title: "NFT mint",
      description:
        "Deploy an ERC-721 straight from the browser, then mint. No Foundry required to run it.",
      highlights: [
        "Self-contained ERC-721 with on-chain art",
        "Bundled bytecode → browser deploy",
        "Mint + on-chain reads",
      ],
    },
    {
      title: "Token-gated app",
      description:
        "Show content only to holders of an access-pass NFT. Deploy the pass, mint one, and the gate opens.",
      highlights: [
        "Client-side ownership check (balanceOf)",
        "Access-pass ERC-721, deployed from the browser",
        "Notes on checking ownership server-side",
      ],
    },
    {
      title: "ERC-20 token",
      description:
        "Deploy a demo ERC-20 from the browser, mint from its open faucet function, and transfer.",
      highlights: [
        "Self-contained ERC-20 (18 decimals)",
        "Deploy + mint + transfer",
        "parseUnits / formatUnits helpers",
      ],
    },
    {
      title: "ICM cross-chain messenger",
      description:
        "Send a message between two Avalanche L1s with Interchain Messaging, on a local devnet that one command starts. Needs Avalanche CLI.",
      highlights: [
        "One command: 2 local L1s + ICM + relayer",
        "Teleporter send + receive contract",
        "Watch a message cross chains live",
      ],
    },
    {
      title: "Confidential token (eERC)",
      description:
        "Register and unlock a private balance on a shared Fuji instance of Avalanche's Encrypted ERC. To mint, transfer and burn with hidden amounts, deploy your own instance with one script.",
      highlights: [
        "Zero-knowledge proofs, generated in the browser",
        "Hidden balances and transfer amounts",
        "Built on the official @avalabs/eerc-sdk",
      ],
    },
    {
      title: "Launch your own L1",
      description:
        "Start your own Avalanche L1 on a local network with one command, then explore blocks, send transactions, and deploy a contract in a built-in dashboard. Needs Avalanche CLI.",
      highlights: [
        "One command → your own Subnet-EVM chain, locally",
        "Built-in block explorer (no Docker, no indexer)",
        "Advanced: a script to launch it on Fuji",
      ],
    },
    {
      title: "Cross-chain token bridge (ICTT)",
      description:
        "Bridge an ERC-20 between two Avalanche L1s with Interchain Token Transfer, on a local devnet that one command starts. Needs Avalanche CLI.",
      highlights: [
        "One command: 2 L1s + relayer + a full ICTT bridge",
        "Lock on one chain, mint on the other, then back",
        "Home/Remote contracts compiled from ava-labs/icm-contracts",
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
      "Connect a wallet, send a first transaction",
      "Mint NFTs from the browser",
      "Deploy a demo token",
      "Gate content to holders",
      "Try a confidential token",
      "Send cross-chain messages",
      "Launch my own L1",
      "Bridge tokens across L1s",
    ],
  },
  mcp: {
    eyebrow: "AI-native",
    title: "Let your agent build on Avalanche",
    lead: "@avakit/mcp gives Claude Code and Cursor tools that act: scaffold an app, deploy its contract and mint on the Fuji testnet, with a test wallet built in. Ask in natural language.",
    add: "Add it to your MCP client:",
    headTool: "Tool",
    headDoes: "Does",
    tools: [
      "Create an Avalanche dapp from a template.",
      "List the templates and the chains each one supports.",
      "Read a balance, a tx receipt, or a contract view function.",
      "Estimate gas for a call before you send it.",
      "Deploy a compiled contract, from an artifact file or from bytecode. On Fuji it signs with a built-in test wallet; mainnet needs your own key and two explicit opt-ins.",
      "Send a contract call such as mint. It is simulated first, and the same Fuji test wallet and mainnet gates apply.",
      "Show which wallet the server would sign with on a chain, and its balance.",
      "AvaKit + Avalanche coding context and doc links.",
    ],
    cta: "Set up the MCP server",
    advanced: "Advanced · for Claude Code / Cursor users",
    beginner:
      "New here? You don't need this. Start with the one-command scaffold above (or watch the walkthrough). MCP is an optional power-up once you already build with Claude Code or Cursor — it needs a config file, not a chat message.",
  },
  faq: {
    eyebrow: "FAQ",
    title: "Questions, answered",
    items: [
      {
        q: "Do my users need a seed phrase?",
        a: "No. The Fuji templates offer social login (Google, Apple or email through Web3Auth), and every template works with browser wallets such as Core and MetaMask; those keys stay with the wallet provider and never pass through AvaKit. For trying things out there is also a temporary wallet with no seed phrase, extension or account. It is testnet-only and, by design, keeps a throwaway key in the browser's storage.",
      },
      {
        q: "Is it locked to a specific wallet or provider?",
        a: "No. Wallets sit behind an adapter interface, so you can use a browser wallet, Web3Auth social login, a Coinbase passkey wallet, the temporary wallet, or an adapter of your own. The app's own UI is plain code in your repo; the wallet button comes from @avakit/react and follows your theme tokens.",
      },
      {
        q: "What chains are supported?",
        a: "Avalanche Fuji (testnet, the default), C-Chain (mainnet, opt-in), and any custom EVM L1 through defineChain. The scaffolder wires Fuji by default; only the minimal template can be scaffolded for C-Chain, and three templates run on a local devnet.",
      },
      {
        q: "How is it 'AI-native'?",
        a: "Every scaffolded app ships CLAUDE.md, llms.txt and .cursor rules, and @avakit/mcp lets Claude Code or Cursor scaffold an app, deploy its contract, send a contract call such as mint, and read chain state. On Fuji the server signs with a temporary test wallet; mainnet needs your own key and two explicit opt-ins.",
      },
      {
        q: "Is it production-ready?",
        a: "Not yet. AvaKit is pre-1.0: all five packages are published on npm and the scaffold, deploy and mint path runs on Fuji, but APIs may still change. It has one maintainer, and three templates and the local dashboard depend on Avalanche CLI, which is in maintenance mode. Mainnet is a separate, explicit step.",
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
  footer: { tagline: "An open-source, AI‑native developer toolkit for Avalanche." },
  cinematic: {
    line1: "create-next-app, but for Avalanche.",
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
    "Tek komutla çalışan bir Avalanche dapp'i kur: Fuji'de fonlanan geçici bir test cüzdanı, istediğinde sosyal giriş ve tarayıcı cüzdanları, üstüne gömülü AI ajan bağlamı. Tek çekirdek, dört yüzey.",
  nav: ["Dokümanlar", "Şablonlar", "MCP", "AvaKit Studio"],
  header: { search: "Ara", getStarted: "Başla", tryIt: "Hemen dene" },
  hero: {
    badge: "Açık kaynak · AI-native · MIT",
    titleBefore: "Şunun üzerine inşa etmek için geliştirici araç seti:",
    titleHighlight: "Avalanche",
    ctaPrimary: "Başla",
    ctaSecondary: "Şablonlara göz at",
    terminal: [
      "Şablon · NFT mint",
      "Ağ · Fuji testnet",
      "Paket yöneticisi · npm",
      `${NFT_MINT_FILE_COUNT} dosya oluşturuldu`,
      "Bağımlılıklar kuruldu",
      "cd my-app && npm run dev",
      "Yerel: http://localhost:3000",
    ],
  },
  surfacesSection: {
    eyebrow: "Mimari",
    title: "Tek çekirdek, beş paket",
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
        "Cüzdan adaptörleri: geçici cüzdan, sosyal giriş, tarayıcı cüzdanı",
        "Deploy yardımcıları ve salt-okunur zincir verisi",
      ],
    },
    {
      name: "@avakit/react",
      tagline: "Hazır cüzdan arayüzü + hook'lar",
      points: [
        "<ConnectAvalanche /> cüzdan butonu ve seçici",
        "Hook'lar: useAvaAccount, useBalance, useContract…",
        "shadcn/ui stili, otomatik zincir değişimi",
      ],
    },
    {
      name: "create-avalanche-app",
      tagline: "Tek komutluk scaffolder",
      points: [
        "Tek komut → Fuji testnet'te çalışan bir dapp",
        "Sekiz şablon: ilk işlemden kendi L1'ine",
        "CLAUDE.md / llms.txt / .cursor kuralları ile gelir",
      ],
    },
    {
      name: "@avakit/mcp",
      tagline: "Kodlama ajanları için MCP sunucusu",
      points: [
        "Claude Code / Cursor'dan scaffold, deploy ve mint",
        "Zincir durumunu doğal dille oku",
        "Fuji test cüzdanı gömülü; mainnet çift onaylı",
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
    title: "Kurulum işi, hazır yapılmış",
    lead: "Tekrarlayan kısımlar (cüzdanlar, test fonu, zincir değişimi, deploy) testnet-öncelikli varsayılanlarla halledilir.",
  },
  features: [
    {
      title: "Hemen başla",
      body: "Fuji şablonlarında ilk seçenek Start instantly'dir: tarayıcıda oluşturulan ve AvaKit'in paylaşımlı faucet'inden fonlanan geçici bir cüzdan. İlk işlem için eklenti, seed phrase ya da hesap gerekmez. Sosyal giriş (Web3Auth) ve tarayıcı cüzdanları (Core, MetaMask) bir tık uzakta; onların anahtarları cüzdan sağlayıcısında kalır.",
    },
    {
      title: "Varsayılan olarak AI-native",
      body: "Üretilen her uygulama ajan bağlamıyla gelir (CLAUDE.md, llms.txt, Cursor kuralları); MCP sunucusu Claude Code veya Cursor'ın senin yerine Fuji'de scaffold, deploy ve mint yapmasını sağlar.",
    },
    {
      title: "shadcn/ui, temalı",
      body: "İlk günden dark/light bağlı shadcn/ui stili. Uygulamanın kendi arayüzü reponda duran düz koddur; nötr gri tonlarda gelir, kendi markanı uygularsın. @avakit/react'ten gelen cüzdan butonu da aynı tema token'larını izler.",
    },
    {
      title: "Tarayıcıdan deploy",
      body: "Kontratlı şablonlar derlenmiş bytecode ile gelir; uygulama Foundry kurmadan tarayıcıdan deploy eder. Varsayılan Fuji.",
    },
    {
      title: "Güvenli varsayılanlar",
      body: "Testnet-öncelikli. Mainnet açık ve korumalı, ayrı bir adımdır; sırlar env'de kalır, gerçek bir cüzdanın anahtarları cüzdan sağlayıcısından hiç çıkmaz.",
    },
    {
      title: "Sar, yeniden yazma",
      body: "AvaKit viem, Web3Auth ve Foundry üzerine kurulur: olgun parçalar, kutudan çıktığı gibi birlikte çalışacak şekilde bağlanmış.",
    },
  ],
  differentiation: {
    eyebrow: "Bağlam",
    title: "Resmi araçların yanında",
    lead: "Ava Labs'in Builder Hub'ı çok şeyi kapsıyor: Console içindeki Studio (barındırılan bir prompt'tan-kontrata akışı), salt-okunur bir MCP sunucusu ve Fuji faucet'i. AvaKit bunların yerel, açık kaynak karşılığıdır: kendi klasöründe ve kendi kodlama ajanında yaşar, ilk Fuji işlemi için hesap istemez.",
    note: "2026-11-18'de kontrol edildi. Resmi araçlar hızlı değişiyor; güncel durumları build.avax.network'te.",
    topic: "Konu",
    // No "(Builder Hub)" here, unlike the English header: the table header is
    // upper-cased by CSS, and under lang="tr" that turns the i in an English
    // name into a dotted capital (BUİLDER). The lead above names Builder Hub.
    columns: ["AvaKit", "Resmi Avalanche araçları"],
    rows: [
      {
        label: "Yeni bir dapp başlatmak",
        cells: [
          "npm create avalanche-app: projeyi kendi klasörüne yazan bir npm CLI'ı.",
          "Builder Hub Console'da Studio: bir prompt'tan kontratlara, testlere ve bir Fuji deploy'una giden, barındırılan bir akış. npm'de resmi, tek komutluk bir create-app CLI'ı yok.",
        ],
      },
      {
        label: "İlk Fuji işlemi için hesap",
        cells: [
          "Gerekmez. Geçici bir test cüzdanı, AvaKit'in paylaşımlı ve limitli faucet'inden fonlanır.",
          "Studio ve resmi faucet için ücretsiz bir Builder Hub girişi.",
        ],
      },
      {
        label: "Kodlama ajanları için MCP sunucusu",
        cells: [
          "Okur; Fuji testnet'te yazar da: açık onay kapılarının arkasında kontrat deploy eder ve kontrat çağrısı gönderir.",
          "Salt-okunur: dokümanlara ve zincir verisine bakar, asla imzalamaz.",
        ],
      },
      {
        label: "Mainnet",
        cells: [
          "Ayrı, korumalı bir adım. Yalnızca minimal şablonu C-Chain için scaffold edilir; MCP sunucusu kendi anahtarını ve iki ayrı onayı ister.",
          "Studio içinde, onaya bağlı bir mainnet'e taşıma adımı.",
        ],
      },
      {
        label: "Arkasında kim var",
        cells: ["Tek bakımcılı, bağımsız ve açık kaynak (MIT) bir proje; 1.0 öncesi.", "Ava Labs."],
      },
    ],
  },
  whoFor: {
    eyebrow: "Kimin için",
    title: "İnsanların bugün geliştirdiği şekle göre tasarlandı",
    lead: "Core gibi seedless cüzdanlar son kullanıcıya seed phrase'siz bir giriş yolu açtı; boilerplate'in büyük kısmını da artık kodlama ajanları yazıyor. AvaKit işin geliştirici tarafıyla ilgilenir: tek komut ya da kendi kodlama ajanına tek bir prompt ile, makinende çalışan bir Avalanche dapp'i.",
  },
  audiences: [
    {
      title: "AI-öncelikli & vibe coder'lar",
      body: "Ne istediğini anlat; Claude Code veya Cursor, MCP sunucusu üzerinden uygulamayı scaffold etsin, kontratını deploy etsin ve Fuji'de mint etsin. Kurman gereken bir anahtar yok.",
    },
    {
      title: "Hackathon & hafta sonu geliştiricileri",
      body: "Tek npm komutundan, dakikalar içinde Fuji'de deploy ve mint yapan bir uygulamaya. İlk işlem için seed phrase, hesap ya da zincir ayarı gerekmez.",
    },
    {
      title: "Avalanche'e geçen ekipler",
      body: "Düzenli bir başlangıç noktası: cüzdanlar, zincir değişimi ve deploy, üstüne yerel L1 ve Interchain şablonları; testnet-öncelikli varsayılanlarla. 1.0 öncesidir ve mainnet ayrı, açık bir adımdır.",
    },
  ],
  stepsSection: {
    eyebrow: "Nasıl çalışır",
    title: "Sıfırdan ilk işleme",
    lead: "Üç adım. İlk işlem için seed phrase, hesap ya da zincir ayarı yok.",
  },
  steps: [
    {
      title: "Kur",
      body: "Tek komut çalıştır ya da kodlama ajanına söyle. Sekiz şablondan seç: bir cüzdan, bir NFT mint, gizli bir token, kendi L1'in, zincirler-arası bir köprü ve dahası.",
      code: "npm create avalanche-app@latest my-app",
    },
    {
      title: "Hemen başla",
      body: "Uygulamayı çalıştır ve Start instantly'yi seç. Tarayıcında geçici bir cüzdan oluşturur ve Fuji'de onu AvaKit'in paylaşımlı faucet'inden fonlar. Sosyal giriş ve tarayıcı cüzdanları aynı pencerededir.",
      code: "cd my-app && npm run dev",
    },
    {
      title: "Deploy et ve mint et",
      body: "Önce Deploy'a, sonra Mint'e bas. Kontratın bytecode'u uygulamayla birlikte gelir; iki işlemi de tarayıcı gönderir, kontratın ve mint'in explorer bağlantısını gösterir. Kodlama ajanın aynısını MCP sunucusu üzerinden yapabilir.",
      code: 'await deploy({ abi, bytecode });\nawait nft.write("mint", []);',
    },
  ],
  howTo: {
    eyebrow: "Önce izle",
    title: "Baştan sona, gözünle gör",
    lead: "Sıfırdan dapp'e kısa bir anlatım; Temmuz 2026'da, daha eski bir sürümle kaydedildi: tek komut çalıştır, Google ile giriş yap, Fuji'de deploy edip mint et. Bugün CLI artık cüzdan sormuyor ve uygulama önce geçici bir cüzdan sunuyor; yani girişi atlayabilirsin.",
    watchOnYoutube: "Sesli tam anlatımı YouTube'da izle",
  },
  templatesSection: {
    eyebrow: "Şablonlar",
    title: "Çalışan bir örnekten başla",
    lead: "Cüzdan seçicisi ve AI bağlam dosyalarıyla gelen, çalışan örnek uygulamalar.",
    all: "Tüm şablonlar",
  },
  templatesPage: {
    eyebrow: "Şablonlar",
    title: "Çalışan bir örnekten başla",
    lead: "Her şablon çalışan bir uygulamadır: shadcn/ui, cüzdan seçici, dark/light tema ve Claude Code ile Cursor için AI bağlam dosyaları. Beşi Fuji testnet'te çalışır; üçü yerel bir devnet'te çalışır ve Avalanche CLI ister.",
    more: "Başka bir şablon mu istiyorsun? Katkılar açık: her şablon, packages/create-avalanche-app/templates altında manifest.json içeren bir klasördür.",
    runsOn: {
      fuji: "Fuji testnet",
      fujiAndMainnet: "Fuji testnet · C-Chain isteğe bağlı",
      devnet: "Yerel devnet · Avalanche CLI gerekir",
    },
    experimental: "Deneysel",
    devnetNote:
      "Avalanche CLI'ın başlattığı yerel bir devnet'te çalışır; bu araç Aralık 2025'ten beri bakım modunda. Unix benzeri bir kabuk gerekir (macOS, Linux veya WSL2). Uçtan uca en son Temmuz 2026'da doğrulandı.",
  },
  templates: [
    {
      title: "Minimal",
      description: "En küçük gerçek dapp: cüzdan bağla, bakiyeni oku, bir işlem gönder.",
      highlights: [
        "Geçici cüzdan, sosyal giriş, tarayıcı cüzdanı",
        "Bakiye + ilk işlem",
        "C-Chain mainnet için de scaffold edilebilen tek şablon",
      ],
    },
    {
      title: "NFT mint",
      description:
        "Doğrudan tarayıcıdan bir ERC-721 deploy et, sonra mint et. Çalıştırmak için Foundry gerekmez.",
      highlights: [
        "On-chain görselli, bağımsız ERC-721",
        "Gömülü bytecode → tarayıcıdan deploy",
        "Mint + zincir okuması",
      ],
    },
    {
      title: "Token-gated uygulama",
      description:
        "İçeriği yalnızca bir erişim-geçişi NFT'sine sahip olanlara göster. Geçişi deploy et, bir tane mint et, kapı açılsın.",
      highlights: [
        "İstemci tarafında sahiplik kontrolü (balanceOf)",
        "Tarayıcıdan deploy edilen erişim-geçişi ERC-721'i",
        "Sahipliği sunucu tarafında doğrulama notları",
      ],
    },
    {
      title: "ERC-20 token",
      description:
        "Tarayıcıdan demo bir ERC-20 deploy et, herkese açık faucet fonksiyonundan mint et ve transfer et.",
      highlights: [
        "Bağımsız ERC-20 (18 ondalık)",
        "Deploy + mint + transfer",
        "parseUnits / formatUnits yardımcıları",
      ],
    },
    {
      title: "ICM zincirler-arası mesajlaşma",
      description:
        "Interchain Messaging ile iki Avalanche L1'i arasında mesaj gönder; tek komutla başlayan yerel bir devnet üzerinde. Avalanche CLI gerekir.",
      highlights: [
        "Tek komut: 2 yerel L1 + ICM + relayer",
        "Teleporter gönder + al kontratı",
        "Bir mesajın zincirleri canlı geçişini izle",
      ],
    },
    {
      title: "Gizli token (eERC)",
      description:
        "Avalanche'in Encrypted ERC standardının Fuji'deki paylaşımlı bir örneğinde kaydol ve gizli bakiyeni aç. Gizli tutarlarla mint, transfer ve burn için tek script ile kendi örneğini deploy et.",
      highlights: [
        "Tarayıcıda üretilen sıfır-bilgi kanıtları",
        "Gizli bakiyeler ve transfer tutarları",
        "Resmi @avalabs/eerc-sdk üzerine kurulu",
      ],
    },
    {
      title: "Kendi L1'ini başlat",
      description:
        "Tek komutla yerel bir ağda kendi Avalanche L1'ini başlat; sonra gömülü bir panelde blokları keşfet, işlem gönder ve kontrat deploy et. Avalanche CLI gerekir.",
      highlights: [
        "Tek komut → yerelde kendi Subnet-EVM zincirin",
        "Gömülü blok gezgini (Docker yok, indexer yok)",
        "İleri seviye: Fuji'de başlatmak için bir script",
      ],
    },
    {
      title: "Zincirler-arası token köprüsü (ICTT)",
      description:
        "Interchain Token Transfer ile iki Avalanche L1'i arasında bir ERC-20 köprüle; tek komutla başlayan yerel bir devnet üzerinde. Avalanche CLI gerekir.",
      highlights: [
        "Tek komut: 2 L1 + relayer + tam ICTT köprüsü",
        "Bir zincirde kilitle, diğerinde bas, sonra geri getir",
        "ava-labs/icm-contracts'tan derlenen Home/Remote kontratları",
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
      "Cüzdan bağla, ilk işlemi gönder",
      "Tarayıcıdan NFT mint et",
      "Demo bir token deploy et",
      "İçeriği sahiplere kilitle",
      "Gizli bir token dene",
      "Zincirler-arası mesaj gönder",
      "Kendi L1'imi başlat",
      "L1'ler arası token köprüle",
    ],
  },
  mcp: {
    eyebrow: "AI-native",
    title: "Ajanın Avalanche üzerinde inşa etsin",
    lead: "@avakit/mcp, Claude Code ve Cursor'a iş yapan araçlar verir: bir uygulama scaffold et, kontratını deploy et ve Fuji testnet'te mint et; test cüzdanı içinde gelir. Doğal dille iste.",
    add: "MCP istemcine ekle:",
    headTool: "Araç",
    headDoes: "Ne yapar",
    tools: [
      "Bir şablondan Avalanche dapp'i oluşturur.",
      "Şablonları ve her birinin desteklediği zincirleri listeler.",
      "Bir bakiye, işlem makbuzu veya kontrat view fonksiyonu okur.",
      "Göndermeden önce bir çağrının gazını tahmin eder.",
      "Derlenmiş bir kontratı, bir artifact dosyasından veya bytecode'dan deploy eder. Fuji'de gömülü test cüzdanıyla imzalar; mainnet kendi anahtarını ve iki ayrı açık onayı ister.",
      "Mint gibi bir kontrat çağrısı gönderir. Önce simüle edilir; aynı Fuji test cüzdanı ve aynı mainnet kapıları geçerlidir.",
      "Sunucunun bir zincirde hangi cüzdanla imzalayacağını ve o cüzdanın bakiyesini gösterir.",
      "AvaKit + Avalanche kodlama bağlamı ve doküman linkleri.",
    ],
    cta: "MCP sunucusunu kur",
    advanced: "İleri seviye · Claude Code / Cursor kullananlar için",
    beginner:
      "Yeni misin? Buna ihtiyacın yok. Yukarıdaki tek-komut scaffold ile başla (ya da anlatım videosunu izle). MCP, zaten Claude Code veya Cursor ile geliştirdiğinde işine yarayan opsiyonel bir güçlendirme — ve bir chat mesajına değil, bir config dosyasına eklenir.",
  },
  faq: {
    eyebrow: "SSS",
    title: "Sorular, yanıtlandı",
    items: [
      {
        q: "Kullanıcılarımın seed phrase'e ihtiyacı var mı?",
        a: "Hayır. Fuji şablonları sosyal giriş (Web3Auth üzerinden Google, Apple veya e-posta) sunar; her şablon Core, MetaMask gibi tarayıcı cüzdanlarıyla da çalışır. Bu anahtarlar cüzdan sağlayıcısında kalır ve AvaKit'ten asla geçmez. Denemek için bir de geçici cüzdan var: seed phrase, eklenti ya da hesap istemez. Yalnızca testnet içindir ve, bilerek, tarayıcının depolamasında tek kullanımlık bir anahtar tutar.",
      },
      {
        q: "Belirli bir cüzdana veya sağlayıcıya kilitli mi?",
        a: "Hayır. Cüzdanlar bir adaptör arayüzünün arkasında durur; tarayıcı cüzdanı, Web3Auth sosyal girişi, Coinbase passkey cüzdanı, geçici cüzdan ya da kendi adaptörünü kullanabilirsin. Uygulamanın kendi arayüzü reponda duran düz koddur; cüzdan butonu @avakit/react'ten gelir ve tema token'larını izler.",
      },
      {
        q: "Hangi zincirler destekleniyor?",
        a: "Avalanche Fuji (testnet, varsayılan), C-Chain (mainnet, isteğe bağlı) ve defineChain ile herhangi bir özel EVM L1. Scaffolder varsayılan olarak Fuji'yi bağlar; yalnızca minimal şablonu C-Chain için scaffold edilebilir, üç şablon ise yerel bir devnet'te çalışır.",
      },
      {
        q: "Nasıl 'AI-native'?",
        a: "Scaffold edilen her uygulama CLAUDE.md, llms.txt ve .cursor kurallarıyla gelir; @avakit/mcp, Claude Code veya Cursor'ın bir uygulama scaffold etmesini, kontratını deploy etmesini, mint gibi bir kontrat çağrısı göndermesini ve zincir durumunu okumasını sağlar. Sunucu Fuji'de geçici bir test cüzdanıyla imzalar; mainnet kendi anahtarını ve iki ayrı açık onayı ister.",
      },
      {
        q: "Üretime hazır mı?",
        a: "Henüz değil. AvaKit 1.0 öncesi: beş paketin tümü npm'de yayında ve scaffold, deploy, mint akışı Fuji'de çalışıyor; ama API'ler hâlâ değişebilir. Tek bir bakımcısı var; üç şablon ve yerel panel de bakım modundaki Avalanche CLI'a bağlı. Mainnet ayrı, açık bir adımdır.",
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
    line1: "create-next-app, ama Avalanche için.",
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
  runsOn: TemplateRunsOn;
  mainnet: boolean;
  experimental: boolean;
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
    differentiation: s.differentiation,
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
      tools: MCP_TOOL_NAMES.map((name, i) => ({ name, description: s.mcp.tools[i] })),
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
