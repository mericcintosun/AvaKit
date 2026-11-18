"use client";

import { getPublicClient } from "@avakit/core";
import {
  Button,
  ConnectAvalanche,
  humanizeError,
  shortenAddress,
  useAvaAccount,
  useAvaChain,
  useAvaDeploy,
  useContract,
} from "@avakit/react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { FundingNotice, useFunding } from "@/components/funding";
import { useDeployedContract } from "@/lib/deployed-contract";
import { abi, bytecode } from "@/lib/token-artifact";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const BURN = "0x000000000000000000000000000000000000dEaD" as const;
// Where the address of the token you deploy is remembered in localStorage.
const CONTRACT_STORAGE_KEY = "__PROJECT_NAME__:token-contract";

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
  // Deploying, minting and transferring cost gas. A new wallet has none until
  // the faucet has funded it (see components/funding.tsx).
  const funding = useFunding();

  // The token you deploy is remembered per chain, so a reload does not ask for
  // a second deploy — and it is only used again once the chain confirms there
  // is code at that address (see lib/deployed-contract.ts).
  const deployed = useDeployedContract(CONTRACT_STORAGE_KEY, chain);
  const contractAddress = deployed.address;
  const { read, write } = useContract({ address: contractAddress ?? ZERO, abi });

  const [balance, setBalance] = useState<bigint | null>(null);
  const [supply, setSupply] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<null | "mint" | "transfer">(null);
  const [error, setError] = useState<string | null>(null);

  // Identifies the newest read, so numbers that arrive for a previous account
  // or contract are never shown for the current one.
  const latestRead = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latestRead.current;
    if (!contractAddress || !address) return;
    try {
      const [bal, total] = await Promise.all([read("balanceOf", [address]), read("totalSupply")]);
      if (request !== latestRead.current) return;
      setBalance(bal as bigint);
      setSupply(total as bigint);
    } catch {
      // The read did not come back: the numbers stay "…" until the next one does.
    }
  }, [read, contractAddress, address]);

  useEffect(() => {
    // A different account or contract: drop the previous one's numbers first.
    setBalance(null);
    setSupply(null);
    void refresh();
  }, [refresh]);

  async function handleDeploy() {
    setError(null);
    try {
      const result = await deploy({ abi, bytecode });
      deployed.remember(result.address);
    } catch (e) {
      setError(humanizeError(e));
    }
  }

  async function run(kind: "mint" | "transfer", fn: () => Promise<`0x${string}`>) {
    setBusy(kind);
    setError(null);
    try {
      const hash = await fn();
      // Wait for the tx to be mined before re-reading balances — otherwise the
      // reads race the pending tx and the numbers look unchanged.
      const receipt = await getPublicClient(chain).waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        throw new Error("The transaction reverted on-chain.");
      }
      await refresh();
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  }

  // Forget the remembered token (it stays on-chain) and go back to step 1,
  // e.g. to deploy the new bytecode after editing the contract.
  function startOver() {
    deployed.forget();
    setError(null);
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
      ) : deployed.status === "checking" ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          Looking for the token you deployed on {chain.name}…
        </div>
      ) : deployed.status === "unreachable" ? (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-6">
          <p className="text-muted-foreground text-sm">
            Could not reach {chain.name} to check the token you deployed earlier.
          </p>
          <Button variant="outline" onClick={deployed.recheck}>
            Try again
          </Button>
        </div>
      ) : !contractAddress ? (
        <div className="flex flex-col gap-3 rounded-xl border p-6">
          <p className="text-sm">Step 1 — deploy your ERC-20 contract.</p>
          <Button onClick={handleDeploy} disabled={deployStatus === "deploying" || funding.isEmpty}>
            {deployStatus === "deploying" ? "Deploying…" : "Deploy token contract"}
          </Button>
          <FundingNotice funding={funding} />
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border p-6">
          <Row label="Token" value={`AvaKit Token (AKT) · ${shortenAddress(contractAddress, 6)}`} mono />
          <Row label="Total supply" value={fmt(supply)} mono />
          <Row label="Your balance" value={fmt(balance)} mono />

          <div className="flex flex-col gap-2 pt-2 sm:flex-row">
            <Button
              className="flex-1"
              disabled={busy !== null || funding.isEmpty}
              onClick={() => run("mint", () => write("mint", []))}
            >
              {busy === "mint" ? "Minting…" : "Mint 100 AKT"}
            </Button>
            <Button
              className="flex-1"
              variant="outline"
              disabled={busy !== null || funding.isEmpty || (balance ?? 0n) < parseUnits("10", 18)}
              onClick={() => run("transfer", () => write("transfer", [BURN, parseUnits("10", 18)]))}
            >
              {busy === "transfer" ? "Sending…" : "Burn 10 AKT"}
            </Button>
          </div>
          <FundingNotice funding={funding} />

          <a
            href={`${chain.explorerUrl}/address/${contractAddress}`}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground text-center text-xs underline underline-offset-4"
          >
            View token on explorer
          </a>

          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={startOver}
            disabled={busy !== null}
          >
            Deploy a new token
          </Button>
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
