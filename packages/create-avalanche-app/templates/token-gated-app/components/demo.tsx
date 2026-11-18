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
import { Lock, Moon, Sun, Unlock } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDeployedContract } from "@/lib/deployed-contract";
import { abi, bytecode } from "@/lib/nft-artifact";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
// Where the address of the pass contract you deploy is remembered in localStorage.
const CONTRACT_STORAGE_KEY = "__PROJECT_NAME__:pass-contract";

// What is known about the connected account's pass. "checking" and "error" both
// mean *unknown* — which is never the same thing as "holds no pass".
type Gate =
  | { status: "checking" }
  | { status: "error"; message: string }
  | { status: "ready"; owned: bigint };

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

  // The pass contract you deploy is remembered per chain, so a reload does not
  // ask for a second deploy — and it is only used again once the chain confirms
  // there is code at that address (see lib/deployed-contract.ts).
  const deployed = useDeployedContract(CONTRACT_STORAGE_KEY, chain);
  const contractAddress = deployed.address;
  const { read, write } = useContract({ address: contractAddress ?? ZERO, abi });

  const [gate, setGate] = useState<Gate>({ status: "checking" });
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Identifies the newest balance read, so an answer for a previous account or
  // contract can never open (or close) the gate for the current one.
  const latestRead = useRef(0);

  const refreshGate = useCallback(async () => {
    const request = ++latestRead.current;
    if (!contractAddress || !address) return;
    try {
      const balance = (await read("balanceOf", [address])) as bigint;
      if (request === latestRead.current) setGate({ status: "ready", owned: balance });
    } catch (e) {
      // A read that did not come back is "unknown", not "no pass": say so
      // rather than telling a holder they are locked out.
      if (request === latestRead.current) setGate({ status: "error", message: humanizeError(e) });
    }
  }, [read, contractAddress, address]);

  useEffect(() => {
    // A different account or contract: forget the previous answer before asking
    // again, so one holder's access never carries over to the next wallet.
    setGate({ status: "checking" });
    void refreshGate();
  }, [refreshGate]);

  function retryGate() {
    setGate({ status: "checking" });
    void refreshGate();
  }

  async function handleDeploy() {
    setError(null);
    try {
      const result = await deploy({ abi, bytecode });
      deployed.remember(result.address);
    } catch (e) {
      setError(humanizeError(e));
    }
  }

  async function handleMint() {
    if (!contractAddress) return;
    setMinting(true);
    setError(null);
    try {
      const hash = await write("mint", []);
      // Wait for the mint to be mined before re-reading the gate — otherwise the
      // balance read races the pending tx and the content stays locked.
      const receipt = await getPublicClient(chain).waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        throw new Error("The mint transaction reverted on-chain.");
      }
      await refreshGate();
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setMinting(false);
    }
  }

  // Forget the remembered pass contract (it stays on-chain) and go back to
  // step 1, e.g. to deploy the new bytecode after editing the contract.
  function startOver() {
    deployed.forget();
    setError(null);
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
      ) : deployed.status === "checking" ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          Looking for the pass contract you deployed on {chain.name}…
        </div>
      ) : deployed.status === "unreachable" ? (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-6">
          <p className="text-muted-foreground text-sm">
            Could not reach {chain.name} to check the pass contract you deployed earlier.
          </p>
          <Button variant="outline" onClick={deployed.recheck}>
            Try again
          </Button>
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
      ) : gate.status === "checking" ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          Checking your access pass…
        </div>
      ) : gate.status === "error" ? (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-6">
          <p className="text-sm font-medium">Could not check your access pass</p>
          <p className="text-muted-foreground text-sm">
            The balance read on {chain.name} failed, so it is not known whether you hold a pass.
            That is not the same as holding none — try again. ({gate.message})
          </p>
          <Button variant="outline" onClick={retryGate}>
            Try again
          </Button>
          <PassContract
            href={`${chain.explorerUrl}/address/${contractAddress}`}
            label={shortenAddress(contractAddress, 6)}
            onStartOver={startOver}
            disabled={minting}
          />
        </div>
      ) : gate.owned > 0n ? (
        <div className="flex flex-col gap-3 rounded-xl border p-6">
          <div className="text-foreground flex items-center gap-2 text-sm font-medium">
            <Unlock className="size-4" />
            Access granted
          </div>
          <p className="text-muted-foreground text-sm">
            🎉 You hold {gate.owned.toString()} access pass{gate.owned === 1n ? "" : "es"}. Here's
            the gated content: this section only renders for holders. Put your premium UI,
            downloads, or members area here.
          </p>
          <PassContract
            href={`${chain.explorerUrl}/address/${contractAddress}`}
            label={shortenAddress(contractAddress, 6)}
            onStartOver={startOver}
            disabled={minting}
          />
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
          <PassContract
            href={`${chain.explorerUrl}/address/${contractAddress}`}
            label={shortenAddress(contractAddress, 6)}
            onStartOver={startOver}
            disabled={minting}
          />
        </div>
      )}

      {error ? <p className="text-muted-foreground text-sm">{error}</p> : null}
    </div>
  );
}

/** The pass contract in use, with a way to forget it and deploy another one. */
function PassContract({
  href,
  label,
  onStartOver,
  disabled,
}: {
  href: string;
  label: string;
  onStartOver: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground text-xs underline underline-offset-4"
      >
        Pass contract: {label}
      </a>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={onStartOver}
        disabled={disabled}
      >
        Deploy a new one
      </Button>
    </div>
  );
}
