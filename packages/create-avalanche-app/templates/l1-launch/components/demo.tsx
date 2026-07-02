"use client";

import { deployContract, ensureChain, getPublicClient, getWalletClient } from "@avakit/core";
import {
  Button,
  ConnectAvalanche,
  shortenAddress,
  useAvaAccount,
  useAvaKit,
} from "@avakit/react";
import { Blocks, Check, Copy, ExternalLink, Moon, Rocket, Sun, Wallet } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import { type Address, type Hash, formatEther, formatUnits } from "viem";
import { chain, isConfigured, l1 } from "@/lib/l1";
import { abi, bytecode } from "@/lib/token-artifact";

const CONTRACT_KEY = "l1-launch:token";
const MAX_BLOCKS = 8;

type BlockRow = { number: bigint; hash: Hash; txCount: number; timestamp: bigint };
type TxRow = { hash: Hash; from: Address; to: Address | null; value: bigint };

export function Demo() {
  if (!isConfigured) {
    return (
      <Shell>
        <SetupPanel />
      </Shell>
    );
  }
  return (
    <Shell>
      <Dashboard />
    </Shell>
  );
}

function Dashboard() {
  const { address, isConnected } = useAvaAccount();
  const { provider } = useAvaKit();

  const [height, setHeight] = useState<bigint | null>(null);
  const [gasPrice, setGasPrice] = useState<bigint | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [online, setOnline] = useState(true);

  const [token, setToken] = useState<Address | null>(null);
  const [busy, setBusy] = useState<null | "deploy" | "mint">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(CONTRACT_KEY);
    if (saved) setToken(saved as Address);
  }, []);

  // Live block explorer: poll the L1's RPC for height, gas, the latest blocks,
  // and the transactions inside them. All read-only — no wallet needed.
  useEffect(() => {
    const client = getPublicClient(chain);
    let active = true;
    async function poll() {
      try {
        const [tip, gas] = await Promise.all([client.getBlockNumber(), client.getGasPrice()]);
        if (!active) return;
        setOnline(true);
        setHeight(tip);
        setGasPrice(gas);

        const from = tip > BigInt(MAX_BLOCKS - 1) ? tip - BigInt(MAX_BLOCKS - 1) : 0n;
        const numbers: bigint[] = [];
        for (let n = tip; n >= from; n--) numbers.push(n);
        const fetched = await Promise.all(
          numbers.map((n) => client.getBlock({ blockNumber: n, includeTransactions: true })),
        );
        if (!active) return;

        const blockRows: BlockRow[] = fetched.map((b) => ({
          number: b.number,
          hash: b.hash,
          txCount: b.transactions.length,
          timestamp: b.timestamp,
        }));
        const txRows: TxRow[] = fetched
          .flatMap((b) => b.transactions)
          .filter((t): t is Exclude<typeof t, Hash> => typeof t !== "string")
          .slice(0, 12)
          .map((t) => ({ hash: t.hash, from: t.from, to: t.to, value: t.value }));
        setBlocks(blockRows);
        setTxs(txRows);
      } catch {
        if (active) setOnline(false);
      }
    }
    void poll();
    const timer = setInterval(poll, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  // Your native-token balance, refreshed with the tip.
  useEffect(() => {
    if (!address) {
      setBalance(null);
      return;
    }
    const client = getPublicClient(chain);
    let active = true;
    client
      .getBalance({ address })
      .then((b) => active && setBalance(b))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [address, height]);

  const deployToken = useCallback(async () => {
    if (!provider || !address) return;
    setBusy("deploy");
    setError(null);
    try {
      await ensureChain(provider, chain);
      const { address: deployed } = await deployContract({
        artifact: { abi, bytecode },
        chain,
        provider,
        account: address,
      });
      window.localStorage.setItem(CONTRACT_KEY, deployed);
      setToken(deployed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [provider, address]);

  const mint = useCallback(async () => {
    if (!provider || !address || !token) return;
    setBusy("mint");
    setError(null);
    try {
      await ensureChain(provider, chain);
      const wallet = getWalletClient(chain, provider);
      await wallet.writeContract({
        address: token,
        abi,
        functionName: "mint",
        account: address,
      } as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [provider, address, token]);

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{l1.name}</h1>
        <p className="text-muted-foreground text-sm">
          Your own Avalanche L1, live and explorable. Deploy a contract, send transactions, and
          watch blocks land in real time — no third-party explorer needed.
        </p>
      </div>

      {/* Chain stat strip */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Block height" value={height === null ? "…" : height.toString()} live={online} />
        <Stat label="Chain ID" value={String(chain.id)} />
        <Stat label="Token" value={l1.token} />
        <Stat
          label="Gas price"
          value={gasPrice === null ? "…" : `${formatUnits(gasPrice, 9)} gwei`}
        />
      </section>

      {/* Account + deploy */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border p-5">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">Your account</p>
          {isConnected && address ? (
            <>
              <Row label="Address" value={shortenAddress(address, 6)} mono />
              <Row
                label="Balance"
                value={balance === null ? "…" : `${formatEther(balance)} ${l1.token}`}
                mono
              />
            </>
          ) : (
            <div className="flex flex-col items-start gap-2">
              <p className="text-muted-foreground text-sm">Connect a wallet to transact.</p>
              <ConnectAvalanche />
            </div>
          )}
          {l1.network === "local" && l1.faucetAccount.privateKey ? (
            <p className="text-muted-foreground text-xs">
              Local dev: import the pre-funded EWOQ key (from{" "}
              <span className="font-mono">pnpm l1</span>) to get {l1.token}.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border p-5">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">Demo contract</p>
          {token ? (
            <>
              <Row label="ERC-20" value={shortenAddress(token, 6)} mono />
              <Button onClick={mint} disabled={busy !== null || !isConnected} size="sm">
                {busy === "mint" ? "Minting…" : "Mint 100 AKT"}
              </Button>
              <p className="text-muted-foreground text-xs">
                Each action is a real transaction — watch it appear below.
              </p>
            </>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">
                Deploy an ERC-20 to your chain from the browser.
              </p>
              <Button onClick={deployToken} disabled={busy !== null || !isConnected} size="sm">
                <Rocket className="size-4" />
                {busy === "deploy" ? "Deploying…" : "Deploy demo token"}
              </Button>
            </>
          )}
        </div>
      </section>

      {/* Explorer: blocks + txs */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-xl border p-5">
          <div className="mb-1 flex items-center gap-2">
            <Blocks className="size-4" />
            <span className="text-sm font-semibold">Latest blocks</span>
          </div>
          {blocks.length === 0 ? (
            <p className="text-muted-foreground text-sm">Waiting for blocks…</p>
          ) : (
            blocks.map((b) => (
              <div key={b.hash} className="flex items-center justify-between gap-3 border-b py-1.5 last:border-0">
                <span className="font-mono text-sm">#{b.number.toString()}</span>
                <span className="text-muted-foreground text-xs">{b.txCount} tx</span>
                <span className="text-muted-foreground font-mono text-xs">{ago(b.timestamp)}</span>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-xl border p-5">
          <span className="mb-1 text-sm font-semibold">Latest transactions</span>
          {txs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No transactions yet — deploy the token above.</p>
          ) : (
            txs.map((t) => (
              <div key={t.hash} className="flex flex-col gap-0.5 border-b py-1.5 last:border-0">
                <span className="font-mono text-xs">{shortenAddress(t.hash, 8)}</span>
                <span className="text-muted-foreground text-xs">
                  {shortenAddress(t.from, 4)} →{" "}
                  {t.to ? shortenAddress(t.to, 4) : "contract creation"}
                  {t.value > 0n ? ` · ${formatEther(t.value)} ${l1.token}` : ""}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <NextSteps hasToken={Boolean(token)} />

      {error ? <p className="text-muted-foreground text-sm break-all">{error}</p> : null}
    </>
  );
}

// Guides the user through what to do once their L1 is live: add it to a wallet,
// get gas, deploy something, and (on Fuji) the realities of keeping it running.
function NextSteps({ hasToken }: { hasToken: boolean }) {
  const { provider } = useAvaKit();
  const [added, setAdded] = useState(false);
  const isFuji = l1.network === "fuji";

  const addToWallet = useCallback(async () => {
    if (!provider) return;
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${chain.id.toString(16)}`,
            chainName: chain.name,
            rpcUrls: [chain.rpcUrl],
            nativeCurrency: { name: l1.token, symbol: l1.token, decimals: 18 },
          },
        ],
      });
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } catch {
      // user rejected or wallet unavailable
    }
  }, [provider]);

  return (
    <section className="flex flex-col gap-3 rounded-xl border p-5">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">Next steps</p>
      <div className="flex flex-col gap-2">
        <StepRow n={1} done={added} label="Add this L1 to your wallet">
          <Button size="sm" variant="outline" onClick={addToWallet}>
            <Wallet className="size-4" />
            {added ? "Added" : "Add network"}
          </Button>
        </StepRow>

        <StepRow n={2} label={isFuji ? "Get gas — fund your wallet with test AVAX" : "Get gas — import the EWOQ dev key"}>
          {isFuji ? (
            <a
              href="https://build.avax.network/console/primary-network/faucet"
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground inline-flex items-center gap-1 text-xs underline underline-offset-4"
            >
              Fuji faucet <ExternalLink className="size-3" />
            </a>
          ) : (
            <span className="text-muted-foreground text-xs">
              EWOQ key is pre-funded (printed by <span className="font-mono">pnpm l1</span>).
            </span>
          )}
        </StepRow>

        <StepRow n={3} done={hasToken} label="Deploy your first contract (the demo token above)" />
      </div>

      {isFuji ? (
        <p className="text-muted-foreground border-t pt-3 text-xs">
          ⚠︎ Your L1 only produces blocks while its validator node stays running, and the
          validator's balance drains over time (~1 AVAX ≈ 1 month) — top it up, or the chain goes
          inactive. For an always-on L1, run the validator on a server rather than your laptop.
        </p>
      ) : null}
    </section>
  );
}

function StepRow({
  n,
  label,
  done,
  children,
}: {
  n: number;
  label: string;
  done?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm">
        <span
          className={`flex size-5 items-center justify-center rounded-full border text-xs ${done ? "bg-foreground text-background" : "text-muted-foreground"}`}
        >
          {done ? <Check className="size-3" /> : n}
        </span>
        {label}
      </span>
      {children}
    </div>
  );
}

function ago(timestamp: bigint): string {
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - Number(timestamp));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function Stat({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border p-4">
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {live !== undefined ? (
          <span
            className={`size-1.5 rounded-full ${live ? "bg-foreground animate-pulse" : "bg-muted-foreground/40"}`}
          />
        ) : null}
        {label}
      </span>
      <span className="font-mono text-lg">{value}</span>
    </div>
  );
}

function SetupPanel() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border p-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Launch your own Avalanche L1</h1>
        <p className="text-muted-foreground text-sm">
          One command spins up your own blockchain — a Subnet-EVM L1 on a local Avalanche network —
          and wires this app to it. No test AVAX, no faucet, no always-on node.
        </p>
      </div>
      <CopyCommand command="pnpm l1" />
      <p className="text-muted-foreground text-xs">
        Configure it: <span className="font-mono">L1_NAME=mychain L1_CHAIN_ID=9999 L1_TOKEN=MYL1 pnpm l1</span>.
        Needs{" "}
        <a
          href="https://build.avax.network/docs/tooling/avalanche-cli/get-avalanche-cli"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4"
        >
          avalanche-cli
        </a>
        . When it finishes it writes <span className="font-mono">l1.config.json</span> and this page
        becomes your chain dashboard automatically.
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
      {copied ? (
        <Check className="size-4 shrink-0" />
      ) : (
        <Copy className="text-muted-foreground size-4 shrink-0" />
      )}
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
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 px-6 py-16">
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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={`${mono ? "font-mono" : ""} truncate text-sm`}>{value}</span>
    </div>
  );
}
