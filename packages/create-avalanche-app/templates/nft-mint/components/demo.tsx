"use client";

import { humanizeError,
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
import type { Address } from "viem";
import { abi, bytecode } from "@/lib/nft-artifact";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

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
  const contract = useContract({ address: contractAddress ?? ZERO, abi });

  const [minting, setMinting] = useState(false);
  const [mintHash, setMintHash] = useState<string | null>(null);
  const [supply, setSupply] = useState<bigint | null>(null);
  const [owned, setOwned] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshCounts = useCallback(async () => {
    if (!contractAddress || !address) return;
    try {
      const [total, balance] = await Promise.all([
        contract.read("totalSupply"),
        contract.read("balanceOf", [address]),
      ]);
      setSupply(total as bigint);
      setOwned(balance as bigint);
    } catch {
      // contract not ready yet
    }
  }, [contract, contractAddress, address]);

  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts]);

  async function handleDeploy() {
    setError(null);
    try {
      const result = await deploy({ abi, bytecode });
      setContractAddress(result.address);
    } catch (e) {
      setError(humanizeError(e));
    }
  }

  async function handleMint() {
    if (!contractAddress) return;
    setMinting(true);
    setError(null);
    setMintHash(null);
    try {
      const hash = await contract.write("mint", []);
      setMintHash(hash);
      await refreshCounts();
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setMinting(false);
    }
  }

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
        <h1 className="text-3xl font-semibold tracking-tight">Mint an NFT on Avalanche</h1>
        <p className="text-muted-foreground text-sm">
          Deploy the NFT contract from your wallet, then mint — all on {chain.name}. The bytecode is
          bundled, so no Foundry is needed to run this.
        </p>
      </div>

      {!isConnected || !address ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          Connect a wallet to begin.
        </div>
      ) : !contractAddress ? (
        <div className="flex flex-col gap-3 rounded-xl border p-6">
          <p className="text-sm">Step 1 — deploy your NFT contract.</p>
          <Button onClick={handleDeploy} disabled={deployStatus === "deploying"}>
            {deployStatus === "deploying" ? "Deploying…" : "Deploy NFT contract"}
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
          <Row label="Contract" value={shortenAddress(contractAddress, 6)} mono />
          <Row label="Total minted" value={supply === null ? "…" : supply.toString()} mono />
          <Row label="You own" value={owned === null ? "…" : owned.toString()} mono />

          <Button onClick={handleMint} disabled={minting}>
            {minting ? "Minting…" : "Mint NFT"}
          </Button>

          <a
            href={`${chain.explorerUrl}/address/${contractAddress}`}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground text-center text-xs underline underline-offset-4"
          >
            View contract on explorer
          </a>

          {mintHash ? (
            <a
              href={`${chain.explorerUrl}/tx/${mintHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm break-all underline underline-offset-4"
            >
              ✓ Minted: {mintHash}
            </a>
          ) : null}
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
