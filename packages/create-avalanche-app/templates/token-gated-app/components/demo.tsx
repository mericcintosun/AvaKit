"use client";

import { getPublicClient } from "@avakit/core";
import { humanizeError,
  Button,
  ConnectAvalanche,
  shortenAddress,
  useAvaAccount,
  useAvaChain,
  useAvaDeploy,
  useContract,
} from "@avakit/react";
import { Lock, Moon, Sun, Unlock } from "lucide-react";
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

  const [owned, setOwned] = useState<bigint | null>(null);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshOwned = useCallback(async () => {
    if (!contractAddress || !address) return;
    try {
      const balance = await contract.read("balanceOf", [address]);
      setOwned(balance as bigint);
    } catch {
      // contract not ready
    }
  }, [contract, contractAddress, address]);

  useEffect(() => {
    void refreshOwned();
  }, [refreshOwned]);

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
    try {
      const hash = await contract.write("mint", []);
      // Wait for the mint to be mined before re-reading the gate — otherwise the
      // balance read races the pending tx and the content stays locked.
      const receipt = await getPublicClient(chain).waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        throw new Error("The mint transaction reverted on-chain.");
      }
      await refreshOwned();
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setMinting(false);
    }
  }

  const hasAccess = owned !== null && owned > 0n;

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
        <h1 className="text-3xl font-semibold tracking-tight">Token-gated content</h1>
        <p className="text-muted-foreground text-sm">
          Hold the access-pass NFT to unlock the content below. Deploy the pass contract, mint one,
          and the gate opens — all on {chain.name}.
        </p>
      </div>

      {!isConnected || !address ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          Connect a wallet to begin.
        </div>
      ) : !contractAddress ? (
        <div className="flex flex-col gap-3 rounded-xl border p-6">
          <p className="text-sm">Step 1 — deploy the access-pass contract.</p>
          <Button onClick={handleDeploy} disabled={deployStatus === "deploying"}>
            {deployStatus === "deploying" ? "Deploying…" : "Deploy access-pass contract"}
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
      ) : hasAccess ? (
        <div className="flex flex-col gap-3 rounded-xl border p-6">
          <div className="text-foreground flex items-center gap-2 text-sm font-medium">
            <Unlock className="size-4" />
            Access granted
          </div>
          <p className="text-muted-foreground text-sm">
            🎉 You hold {owned?.toString()} access pass{owned === 1n ? "" : "es"}. Here's the gated
            content: this section only renders for holders. Put your premium UI, downloads, or
            members area here.
          </p>
          <a
            href={`${chain.explorerUrl}/address/${contractAddress}`}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground text-xs underline underline-offset-4"
          >
            Pass contract: {shortenAddress(contractAddress, 6)}
          </a>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-6">
          <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
            <Lock className="size-4" />
            Locked — you don't hold an access pass
          </div>
          <Button onClick={handleMint} disabled={minting}>
            {minting ? "Minting…" : "Mint access pass"}
          </Button>
        </div>
      )}

      {error ? <p className="text-muted-foreground text-sm">{error}</p> : null}
    </div>
  );
}
