"use client";

import { ensureChain, getPublicClient, getWalletClient, readContract } from "@avakit/core";
import {
  Button,
  ConnectAvalanche,
  useAvaAccount,
  useAvaChain,
  useAvaKit,
} from "@avakit/react";
import { ArrowRight, Check, Copy, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import { type Address, formatEther, parseEther } from "viem";
import {
  blockchainIdOf,
  bridge,
  erc20Abi,
  homeAbi,
  homeChain,
  isConfigured,
  remoteAbi,
  remoteChain,
} from "@/lib/ictt";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const GAS_LIMIT = 250000n;

export function Demo() {
  if (!isConfigured || !bridge.bridge) {
    return (
      <Shell>
        <SetupPanel />
      </Shell>
    );
  }
  return (
    <Shell>
      <Bridge addrs={bridge.bridge} />
    </Shell>
  );
}

function Bridge({ addrs }: { addrs: NonNullable<typeof bridge.bridge> }) {
  const { address, isConnected } = useAvaAccount();
  const { provider } = useAvaKit();
  const { setChain } = useAvaChain();

  const [homeBal, setHomeBal] = useState<bigint | null>(null);
  const [remoteBal, setRemoteBal] = useState<bigint | null>(null);
  const [amount, setAmount] = useState("10");
  const [toRemote, setToRemote] = useState(true);
  const [busy, setBusy] = useState<null | "mint" | "bridge">(null);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live balances: the demo token on the home chain, the bridged token on the
  // remote chain. Read-only — no wallet needed.
  useEffect(() => {
    if (!address) return;
    let active = true;
    async function poll() {
      try {
        const [h, r] = await Promise.all([
          readContract(homeChain, { address: addrs.demoToken, abi: erc20Abi, functionName: "balanceOf", args: [address as Address] }),
          readContract(remoteChain, { address: addrs.remote, abi: remoteAbi, functionName: "balanceOf", args: [address as Address] }),
        ]);
        if (!active) return;
        setHomeBal(h as bigint);
        setRemoteBal(r as bigint);
      } catch {
        // chains warming up
      }
    }
    void poll();
    const t = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [address, addrs]);

  const run = useCallback(
    async (kind: "mint" | "bridge", fn: () => Promise<void>) => {
      if (!provider || !address) return;
      setBusy(kind);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [provider, address],
  );

  const mint = () =>
    run("mint", async () => {
      await ensureChain(provider!, homeChain);
      setChain(homeChain);
      const wallet = getWalletClient(homeChain, provider!);
      const hash = await wallet.writeContract({ address: addrs.demoToken, abi: erc20Abi, functionName: "mint", account: address as Address } as never);
      await getPublicClient(homeChain).waitForTransactionReceipt({ hash });
    });

  const doBridge = () =>
    run("bridge", async () => {
      const value = parseEther(amount || "0");
      if (value <= 0n) throw new Error("Enter an amount greater than 0.");
      const source = toRemote ? homeChain : remoteChain;
      const destination = toRemote ? remoteChain : homeChain;
      const transferrer = toRemote ? addrs.home : addrs.remote;
      const destTransferrer = toRemote ? addrs.remote : addrs.home;

      await ensureChain(provider!, source);
      setChain(source);
      const wallet = getWalletClient(source, provider!);
      const pub = getPublicClient(source);

      // Home locks the underlying ERC-20, so bridging OUT of home needs an
      // approval first. The remote token is burned on send back — no approval.
      if (toRemote) {
        const approveHash = await wallet.writeContract({ address: addrs.demoToken, abi: erc20Abi, functionName: "approve", args: [addrs.home, value], account: address as Address } as never);
        await pub.waitForTransactionReceipt({ hash: approveHash });
      }

      const input = {
        destinationBlockchainID: blockchainIdOf(destination),
        destinationTokenTransferrerAddress: destTransferrer,
        recipient: address as Address,
        primaryFeeTokenAddress: ZERO,
        primaryFee: 0n,
        secondaryFee: 0n,
        requiredGasLimit: GAS_LIMIT,
        multiHopFallback: ZERO,
      };
      const sendHash = await wallet.writeContract({
        address: transferrer,
        abi: toRemote ? homeAbi : remoteAbi,
        functionName: "send",
        args: [input, value],
        account: address as Address,
      } as never);
      await pub.waitForTransactionReceipt({ hash: sendHash });
      setInFlight(true);
      setTimeout(() => setInFlight(false), 12000);
    });

  const canBridge =
    isConnected &&
    !!address &&
    busy === null &&
    (toRemote ? (homeBal ?? 0n) >= parseSafe(amount) : (remoteBal ?? 0n) >= parseSafe(amount));

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Cross-chain token bridge</h1>
        <p className="text-muted-foreground text-sm">
          Move an ERC-20 between two Avalanche L1s with Interchain Token Transfer. The home chain
          locks your token; the remote chain mints a bridged version — and back again.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ChainCard
          title={homeChain.name}
          role="Home"
          symbol={bridge.chain1.token}
          balance={homeBal}
          note="The token you bridge (locked here when sent)."
        />
        <ChainCard
          title={remoteChain.name}
          role="Remote"
          symbol={`${bridge.chain1.token}.b`}
          balance={remoteBal}
          note="The bridged token (minted here on arrival)."
          highlight={inFlight}
        />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border p-6">
        <div className="flex items-center justify-between">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <span className="font-mono">{toRemote ? homeChain.name : remoteChain.name}</span>
            <ArrowRight className="size-4" />
            <span className="font-mono">{toRemote ? remoteChain.name : homeChain.name}</span>
          </div>
          {!isConnected || !address ? <ConnectAvalanche /> : null}
        </div>

        <div className="flex gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="Amount"
            className="border-input bg-background flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
          />
          <Button variant="outline" size="sm" onClick={() => setToRemote((v) => !v)} disabled={busy !== null}>
            Swap direction
          </Button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {toRemote ? (
            <Button variant="outline" className="flex-1" onClick={mint} disabled={busy !== null || !isConnected}>
              {busy === "mint" ? "Minting…" : `Mint 100 ${bridge.chain1.token}`}
            </Button>
          ) : null}
          <Button className="flex-1" onClick={doBridge} disabled={!canBridge}>
            {busy === "bridge"
              ? "Bridging…"
              : `Bridge to ${toRemote ? remoteChain.name : homeChain.name}`}
          </Button>
        </div>

        {inFlight ? (
          <p className="flex items-center gap-2 text-sm">
            <span className="bg-foreground size-2 animate-ping rounded-full" />
            In flight — the relayer is carrying your tokens across…
          </p>
        ) : null}
        {error ? (
          <p className="border-destructive text-destructive rounded-md border px-3 py-2 text-sm font-medium break-all">
            {error}
          </p>
        ) : null}
      </section>
    </>
  );
}

function parseSafe(v: string): bigint {
  try {
    return parseEther(v || "0");
  } catch {
    return 0n;
  }
}

function ChainCard({
  title,
  role,
  symbol,
  balance,
  note,
  highlight,
}: {
  title: string;
  role: string;
  symbol: string;
  balance: bigint | null;
  note: string;
  highlight?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-2 rounded-xl border p-5 transition-colors ${highlight ? "border-foreground" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold">{title}</span>
        <span className="text-muted-foreground text-xs">{role}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-2xl">{balance === null ? "…" : formatEther(balance)}</span>
        <span className="text-muted-foreground text-sm">{symbol}</span>
      </div>
      <p className="text-muted-foreground text-xs">{note}</p>
    </div>
  );
}

function SetupPanel() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border p-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Spin up your cross-chain bridge</h1>
        <p className="text-muted-foreground text-sm">
          This app bridges an ERC-20 between two Avalanche L1s using Interchain Token Transfer. Bring
          up the two chains, a relayer, and the full bridge — one command in your terminal:
        </p>
      </div>
      <CopyCommand command="pnpm bridge" />
      <p className="text-muted-foreground text-xs">
        Needs{" "}
        <a
          href="https://build.avax.network/docs/tooling/avalanche-cli/get-avalanche-cli"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4"
        >
          avalanche-cli
        </a>
        . When it finishes it writes <span className="font-mono">bridge.config.json</span> and this
        page becomes the bridge automatically.
      </p>
    </div>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="bg-muted hover:bg-muted/70 flex items-center justify-between gap-4 rounded-lg p-4 text-left font-mono text-sm transition-colors"
    >
      <span>
        <span className="text-muted-foreground select-none">$ </span>
        {command}
      </span>
      {copied ? <Check className="size-4 shrink-0" /> : <Copy className="text-muted-foreground size-4 shrink-0" />}
    </button>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden size-4 dark:block" />
      <Moon className="block size-4 dark:hidden" />
    </Button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold">__PROJECT_NAME__</span>
        <div className="flex items-center gap-2">
          <ConnectAvalanche />
          <ThemeToggle />
        </div>
      </header>
      {children}
    </div>
  );
}
