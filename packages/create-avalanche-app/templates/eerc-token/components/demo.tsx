"use client";

import { getPublicClient, toViemChain } from "@avakit/core";
import { humanizeError, Button, ConnectAvalanche, shortenAddress, useAvaKit } from "@avakit/react";
import { useEERC } from "@avalabs/eerc-sdk";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type Address, createWalletClient, custom, formatUnits, parseUnits } from "viem";
import { FundingNotice, useFunding } from "@/components/funding";
import {
  CircuitDownloadError,
  type CircuitURLs,
  EERC_CONTRACT_ADDRESS,
  loadVerifiedCircuits,
  usesSharedInstance,
} from "@/lib/eerc-config";

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
  const { address, provider, chain, status } = useAvaKit();
  const isConnected = status === "connected";

  // Download + SHA-256-verify the proving circuits before the SDK ever sees
  // them (see lib/eerc-config.ts). Starts on mount, in parallel with the
  // user connecting a wallet.
  // A download that failed can be retried; a file that failed its integrity
  // check cannot (retrying only downloads and refuses it again), so it gets no
  // button.
  const [circuits, setCircuits] = useState<CircuitURLs | null>(null);
  const [circuitError, setCircuitError] = useState<{ message: string; retry: boolean } | null>(null);
  const loadCircuits = useCallback(() => {
    setCircuitError(null);
    loadVerifiedCircuits()
      .then(setCircuits)
      .catch((e: unknown) =>
        setCircuitError({
          message: e instanceof Error ? e.message : String(e),
          retry: e instanceof CircuitDownloadError,
        }),
      );
  }, []);
  useEffect(() => {
    loadCircuits();
  }, [loadCircuits]);

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
        <h1 className="text-3xl font-semibold tracking-tight">Confidential token transfers</h1>
        <p className="text-muted-foreground text-sm">
          Register, mint, and transfer tokens with hidden balances and amounts on {chain.name},
          using Avalanche's Encrypted ERC (eERC) standard. Proofs are generated fully client-side.
        </p>
      </div>

      {circuitError?.retry ? (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-6">
          <p className="text-muted-foreground text-sm">{circuitError.message}</p>
          <Button variant="outline" onClick={loadCircuits}>
            Try again
          </Button>
        </div>
      ) : circuitError ? (
        <p className="border-destructive text-destructive rounded-md border px-3 py-2 text-sm font-medium">
          {circuitError.message}
        </p>
      ) : !isConnected || !address || !provider ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          Connect a wallet to begin.
        </div>
      ) : !circuits ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          Verifying proving circuits… (~50 MB on first visit, checked against pinned SHA-256
          hashes, then browser-cached)
        </div>
      ) : (
        <EercPanel
          address={address}
          provider={provider}
          explorerUrl={chain.explorerUrl}
          circuits={circuits}
        />
      )}
    </div>
  );
}

function EercPanel({
  address,
  provider,
  explorerUrl,
  circuits,
}: {
  address: Address;
  provider: NonNullable<ReturnType<typeof useAvaKit>["provider"]>;
  explorerUrl: string;
  circuits: CircuitURLs;
}) {
  const { chain } = useAvaKit();
  // Registering, minting, transferring and burning are transactions and cost
  // gas. A new wallet has none until the faucet has funded it (see
  // components/funding.tsx). Unlocking is only a signature, so it is never held
  // back.
  const funding = useFunding();

  // eERC needs a wallet client with an account already attached (viem's
  // "account hoisting"), unlike @avakit/core's getWalletClient, which passes
  // account per-call. Build one directly from the connected provider.
  const publicClient = useMemo(() => getPublicClient(chain), [chain]);
  const walletClient = useMemo(
    () => createWalletClient({ chain: toViemChain(chain), transport: custom(provider), account: address }),
    [chain, provider, address],
  );

  const eerc = useEERC(publicClient, walletClient, EERC_CONTRACT_ADDRESS, circuits);
  const balance = eerc.useEncryptedBalance();

  const [unlocked, setUnlocked] = useState(false);
  const [mintAmount, setMintAmount] = useState("10");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("5");
  const [burnAmount, setBurnAmount] = useState("1");
  const [busy, setBusy] = useState<
    null | "register" | "unlock" | "auditor" | "mint" | "transfer" | "burn"
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<{ transactionHash?: string } | void>) {
    setBusy(kind);
    setError(null);
    try {
      const result = await fn();
      if (result && "transactionHash" in result && result.transactionHash) {
        setLastTx(result.transactionHash);
      }
      balance.refetchBalance();
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  }

  if (!eerc.isAllDataFetched) {
    return (
      <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
        Loading eERC state…
      </div>
    );
  }

  if (!eerc.isRegistered) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border p-6">
        <p className="text-sm">Step 1 — register a confidential account (signature, no gas cost beyond the tx).</p>
        <Button
          disabled={busy !== null || funding.isEmpty}
          onClick={() => run("register", async () => { await eerc.register(); setUnlocked(true); })}
        >
          {busy === "register" ? "Registering…" : "Register"}
        </Button>
        <FundingNotice funding={funding} />
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border p-6">
        <p className="text-sm">
          Step 2 — unlock your private balance for this session (a free signature, derives your
          decryption key locally; nothing is sent on-chain).
        </p>
        <Button
          disabled={busy !== null}
          onClick={() => run("unlock", async () => { await eerc.generateDecryptionKey(); setUnlocked(true); })}
        >
          {busy === "unlock" ? "Unlocking…" : "Unlock private balance"}
        </Button>
      </div>
    );
  }

  const decimals = Number(balance.decimals ?? 2n);
  const fmt = (v: bigint) => `${formatUnits(v, decimals)} ${eerc.symbol || "TEST"}`;

  // Minting is owner-only on-chain (compliance by design), and every mint /
  // transfer / burn requires the instance's auditor key to be set — the owner
  // does both against their own instance (`npm run deploy:eerc`).
  const isOwner = Boolean(eerc.owner && eerc.owner.toLowerCase() === address.toLowerCase());

  return (
    <div className="flex flex-col gap-4 rounded-xl border p-6">
      <Row label="Token" value={`${eerc.name || "eERC"} (${eerc.symbol || "TEST"})`} mono />
      <Row label="Your private balance" value={fmt(balance.decryptedBalance)} mono />
      <Row label="Your account" value={shortenAddress(address, 6)} mono />

      {/* Every action below is a transaction: none can be sent from an empty wallet. */}
      <FundingNotice funding={funding} />

      {isOwner && !eerc.isAuditorKeySet ? (
        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-sm">Set the auditor (owner step, one-time)</p>
          <p className="text-muted-foreground text-xs">
            You own this instance, but its auditor key is not set yet — every mint, transfer, and
            burn reverts until it is. This registers your own account as the auditor.
          </p>
          <Button
            disabled={busy !== null || funding.isEmpty}
            onClick={() =>
              run("auditor", async () => {
                await eerc.setContractAuditorPublicKey(address);
                eerc.refetchAuditor();
              })
            }
          >
            {busy === "auditor" ? "Setting auditor…" : "Set auditor"}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t pt-4">
        <p className="text-sm">Mint privately to yourself</p>
        {isOwner ? null : usesSharedInstance ? (
          <p className="text-muted-foreground text-xs">
            Minting is owner-only, and this app is pointed at the shared demo instance — run{" "}
            <span className="font-mono">npm run deploy:eerc</span> to deploy your own instance, then
            connect the deployer wallet to mint.
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            Minting is owner-only. This app is pointed at your own instance, so connect the wallet
            that deployed it
            {eerc.owner ? (
              <>
                {" "}
                (<span className="font-mono">{shortenAddress(eerc.owner, 6)}</span>)
              </>
            ) : null}{" "}
            to mint.
          </p>
        )}
        <div className="flex gap-2">
          <AmountInput value={mintAmount} onChange={setMintAmount} />
          <Button
            disabled={busy !== null || funding.isEmpty || !isOwner || !eerc.isAuditorKeySet}
            onClick={() =>
              run("mint", () => balance.privateMint(address, parseUnits(mintAmount || "0", decimals)))
            }
          >
            {busy === "mint" ? "Minting…" : "Mint"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t pt-4">
        <p className="text-sm">Confidential transfer</p>
        <input
          className="border-input bg-transparent rounded-md border px-3 py-2 text-sm"
          placeholder="Recipient address (0x…, must be registered)"
          value={transferTo}
          onChange={(e) => setTransferTo(e.target.value)}
        />
        <div className="flex gap-2">
          <AmountInput value={transferAmount} onChange={setTransferAmount} />
          <Button
            disabled={busy !== null || funding.isEmpty || !transferTo}
            onClick={() =>
              run("transfer", () =>
                balance.privateTransfer(transferTo, parseUnits(transferAmount || "0", decimals)),
              )
            }
          >
            {busy === "transfer" ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t pt-4">
        <p className="text-sm">Burn privately</p>
        <div className="flex gap-2">
          <AmountInput value={burnAmount} onChange={setBurnAmount} />
          <Button
            variant="outline"
            disabled={busy !== null || funding.isEmpty}
            onClick={() => run("burn", () => balance.privateBurn(parseUnits(burnAmount || "0", decimals)))}
          >
            {busy === "burn" ? "Burning…" : "Burn"}
          </Button>
        </div>
      </div>

      {lastTx ? (
        <a
          href={`${explorerUrl}/tx/${lastTx}`}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground text-center text-xs underline underline-offset-4"
        >
          View last transaction on explorer
        </a>
      ) : null}

      {error ? (
        <p className="border-destructive text-destructive rounded-md border px-3 py-2 text-sm font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AmountInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className="border-input bg-transparent w-24 rounded-md border px-3 py-2 text-sm"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
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
