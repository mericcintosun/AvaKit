"use client";

import {
  Button,
  ConnectAvalanche,
  shortenAddress,
  useAvaAccount,
  useAvaChain,
  useAvaDeploy,
  useContract,
} from "@avakit/react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import { type Address, formatUnits, parseUnits } from "viem";
import { abi, bytecode } from "@/lib/token-artifact";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const BURN = "0x000000000000000000000000000000000000dEaD" as const;

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

export function Demo() {
  const { address, isConnected } = useAvaAccount();
  const { chain } = useAvaChain();
  const { deploy, status: deployStatus } = useAvaDeploy();

  const [contractAddress, setContractAddress] = useState<Address | null>(null);
  const token = useContract({ address: contractAddress ?? ZERO, abi });

  const [balance, setBalance] = useState<bigint | null>(null);
  const [supply, setSupply] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<null | "mint" | "transfer">(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!contractAddress || !address) return;
    try {
      const [bal, total] = await Promise.all([
        token.read("balanceOf", [address]),
        token.read("totalSupply"),
      ]);
      setBalance(bal as bigint);
      setSupply(total as bigint);
    } catch {
      // not ready
    }
  }, [token, contractAddress, address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleDeploy() {
    setError(null);
    try {
      const result = await deploy({ abi, bytecode });
      setContractAddress(result.address);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function run(kind: "mint" | "transfer", fn: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const fmt = (v: bigint | null) => (v === null ? "…" : `${formatUnits(v, 18)} AKT`);

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-6 py-16">
      <header className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold">__PROJECT_NAME__</span>
        <div className="flex items-center gap-2">
          <ConnectAvalanche />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Launch an ERC-20 token</h1>
        <p className="text-muted-foreground text-sm">
          Deploy your token contract from the browser, mint some supply, and transfer — all on{" "}
          {chain.name}. Bytecode is bundled, so no Foundry is needed to run this.
        </p>
      </div>

      {!isConnected || !address ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          Connect a wallet to begin.
        </div>
      ) : !contractAddress ? (
        <div className="flex flex-col gap-3 rounded-xl border p-6">
          <p className="text-sm">Step 1 — deploy your ERC-20 contract.</p>
          <Button onClick={handleDeploy} disabled={deployStatus === "deploying"}>
            {deployStatus === "deploying" ? "Deploying…" : "Deploy token contract"}
          </Button>
          {chain.faucetUrl ? (
            <a
              href={chain.faucetUrl}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground text-center text-xs underline underline-offset-4"
            >
              Need test AVAX? Open the faucet
            </a>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border p-6">
          <Row label="Token" value={`AvaKit Token (AKT) · ${shortenAddress(contractAddress, 6)}`} mono />
          <Row label="Total supply" value={fmt(supply)} mono />
          <Row label="Your balance" value={fmt(balance)} mono />

          <div className="flex flex-col gap-2 pt-2 sm:flex-row">
            <Button
              className="flex-1"
              disabled={busy !== null}
              onClick={() => run("mint", () => token.write("mint", []))}
            >
              {busy === "mint" ? "Minting…" : "Mint 100 AKT"}
            </Button>
            <Button
              className="flex-1"
              variant="outline"
              disabled={busy !== null || (balance ?? 0n) < parseUnits("10", 18)}
              onClick={() => run("transfer", () => token.write("transfer", [BURN, parseUnits("10", 18)]))}
            >
              {busy === "transfer" ? "Sending…" : "Burn 10 AKT"}
            </Button>
          </div>

          <a
            href={`${chain.explorerUrl}/address/${contractAddress}`}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground text-center text-xs underline underline-offset-4"
          >
            View token on explorer
          </a>
        </div>
      )}

      {error ? <p className="text-muted-foreground text-sm">{error}</p> : null}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={mono ? "font-mono text-sm" : "text-sm"}>{value}</span>
    </div>
  );
}
