"use client";

import { getWalletClient } from "@avakit/core";
import {
  Button,
  shortenAddress,
  useAvaAccount,
  useAvaChain,
  useAvaKit,
  useBalance,
} from "@avakit/react";
import { useState } from "react";
import { formatEther } from "viem";

/** The interactive part of the page; the static shell lives in app/page.tsx. */
export function Demo() {
  const { address, isConnected } = useAvaAccount();
  const { chain } = useAvaChain();
  const { provider } = useAvaKit();
  const { data: balance, isLoading, refetch } = useBalance();
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function sendTestTx() {
    if (!provider || !address) return;
    setSending(true);
    setTxError(null);
    setTxHash(null);
    try {
      const wallet = getWalletClient(chain, provider);
      const hash = await wallet.sendTransaction({
        account: address,
        to: address,
        value: 0n,
      } as Parameters<typeof wallet.sendTransaction>[0]);
      setTxHash(hash);
      void refetch();
    } catch (e) {
      setTxError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Your first transaction on Avalanche
        </h1>
        <p className="text-muted-foreground text-sm">
          Connect a wallet, read your balance, and send a 0-AVAX transaction to yourself on{" "}
          {chain.name}.
        </p>
      </div>

      {isConnected && address ? (
        <div className="flex flex-col gap-4 rounded-xl border p-6">
          <Row label="Network" value={chain.name} />
          <Row label="Address" value={shortenAddress(address, 6)} mono />
          <Row
            label="Balance"
            value={isLoading ? "…" : `${formatEther(balance ?? 0n)} ${chain.nativeCurrency.symbol}`}
            mono
          />

          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={sendTestTx} disabled={sending}>
              {sending ? "Sending…" : "Send 0 AVAX to myself"}
            </Button>
            {chain.faucetUrl ? (
              <a
                href={chain.faucetUrl}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground text-center text-xs underline underline-offset-4"
              >
                Need test AVAX? Open the Fuji faucet
              </a>
            ) : null}
          </div>

          {txHash ? (
            <a
              href={`${chain.explorerUrl}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm break-all underline underline-offset-4"
            >
              ✓ Sent: {txHash}
            </a>
          ) : null}
          {txError ? <p className="text-muted-foreground text-sm">{txError}</p> : null}
        </div>
      ) : (
        <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          Connect a wallet to begin.
        </div>
      )}
    </>
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
