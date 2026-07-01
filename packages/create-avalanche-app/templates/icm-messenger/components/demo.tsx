"use client";

import { deployContract, ensureChain, getWalletClient, readContract } from "@avakit/core";
import type { AvaChain } from "@avakit/core/chains";
import {
  Button,
  ConnectAvalanche,
  shortenAddress,
  useAvaAccount,
  useAvaChain,
  useAvaKit,
} from "@avakit/react";
import { ArrowRight, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { blockchainIdOf, chain1, chain2, icm, isConfigured } from "@/lib/devnet";
import { abi, bytecode } from "@/lib/messenger-artifact";

const STORAGE_KEY = "icm-messenger:addresses";

type AddrMap = Record<number, Address>;

function loadAddrs(): AddrMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as AddrMap;
  } catch {
    return {};
  }
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

export function Demo() {
  const { address, isConnected } = useAvaAccount();
  const { provider } = useAvaKit();
  const { setChain } = useAvaChain();

  const [addrs, setAddrs] = useState<AddrMap>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState("gm from the other chain");
  const [source, setSource] = useState<AvaChain>(chain1);
  const [sentHash, setSentHash] = useState<string | null>(null);
  const [received, setReceived] = useState<Record<number, { message: string; count: bigint }>>({});
  const [error, setError] = useState<string | null>(null);

  const destination = source.id === chain1.id ? chain2 : chain1;

  useEffect(() => {
    setAddrs(loadAddrs());
  }, []);

  const setAddr = useCallback((chainId: number, addr: Address) => {
    setAddrs((prev) => {
      const next = { ...prev, [chainId]: addr };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const bothDeployed = Boolean(addrs[chain1.id] && addrs[chain2.id]);

  const deployOn = useCallback(
    async (chain: AvaChain) => {
      if (!provider || !address) return;
      setBusy(`deploy:${chain.id}`);
      setError(null);
      try {
        await ensureChain(provider, chain);
        setChain(chain);
        const { address: deployed } = await deployContract({
          artifact: { abi, bytecode },
          chain,
          provider,
          account: address,
        });
        setAddr(chain.id, deployed);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [provider, address, setAddr, setChain],
  );

  const sendMessage = useCallback(async () => {
    if (!provider || !address) return;
    const from = addrs[source.id];
    const to = addrs[destination.id];
    if (!from || !to) return;
    setBusy("send");
    setError(null);
    setSentHash(null);
    try {
      await ensureChain(provider, source);
      setChain(source);
      const wallet = getWalletClient(source, provider);
      const hash = await wallet.writeContract({
        address: from,
        abi,
        functionName: "sendMessage",
        args: [blockchainIdOf(destination), to, text],
        account: address,
      } as never);
      setSentHash(hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [provider, address, addrs, source, destination, text, setChain]);

  // Poll each deployed messenger for the last received message.
  useEffect(() => {
    if (!bothDeployed) return;
    let active = true;
    const pairs: [AvaChain, Address][] = [
      [chain1, addrs[chain1.id] as Address],
      [chain2, addrs[chain2.id] as Address],
    ];
    async function poll() {
      const next: Record<number, { message: string; count: bigint }> = {};
      await Promise.all(
        pairs.map(async ([chain, addr]) => {
          try {
            const [message, count] = await Promise.all([
              readContract(chain, { address: addr, abi, functionName: "lastMessage" }),
              readContract(chain, { address: addr, abi, functionName: "messagesReceived" }),
            ]);
            next[chain.id] = { message: message as string, count: count as bigint };
          } catch {
            // not ready yet
          }
        }),
      );
      if (active) setReceived(next);
    }
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [bothDeployed, addrs]);

  const destReceived = received[destination.id];
  const chains = useMemo(() => [chain1, chain2], []);

  if (!isConfigured) {
    return (
      <Shell>
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-8 text-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Start the local devnet first</h1>
          <p className="text-muted-foreground">
            This template sends a message between two Avalanche L1s. Spin them up (with Interchain
            Messaging and a relayer) — one command:
          </p>
          <pre className="bg-muted rounded-lg p-4 font-mono text-xs">pnpm devnet</pre>
          <p className="text-muted-foreground">
            That writes the two chains into <span className="font-mono">icm.config.json</span>. Then
            reload this page.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Send a message across L1s</h1>
        <p className="text-muted-foreground text-sm">
          Deploy the messenger on both local chains, then send a string from one to the other over
          Avalanche Interchain Messaging. The relayer delivers it and the destination contract stores
          it — watch it arrive below.
        </p>
      </div>

      {!isConnected || !address ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          Connect a wallet (import the EWOQ dev key) to begin.
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3">
            {chains.map((chain) => (
              <div key={chain.id} className="flex flex-col gap-3 rounded-xl border p-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold">{chain.name}</span>
                  <span className="text-muted-foreground text-xs">chainId {chain.id}</span>
                </div>
                {addrs[chain.id] ? (
                  <Row label="Messenger" value={shortenAddress(addrs[chain.id] as Address, 6)} mono />
                ) : (
                  <Button
                    onClick={() => deployOn(chain)}
                    disabled={busy === `deploy:${chain.id}`}
                    size="sm"
                  >
                    {busy === `deploy:${chain.id}` ? "Deploying…" : "Deploy messenger"}
                  </Button>
                )}
                <Row
                  label="Last received"
                  value={received[chain.id]?.message || "—"}
                  mono
                />
                <Row
                  label="Total received"
                  value={received[chain.id]?.count?.toString() ?? "0"}
                  mono
                />
              </div>
            ))}
          </section>

          <section className="flex flex-col gap-3 rounded-xl border p-6">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <span className="font-mono">{source.name}</span>
              <ArrowRight className="size-4" />
              <span className="font-mono">{destination.name}</span>
            </div>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Message to send cross-chain"
              className="border-input bg-background rounded-lg border px-3 py-2 text-sm outline-none"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSource(destination)}
                disabled={busy === "send"}
              >
                Swap direction
              </Button>
              <Button
                onClick={sendMessage}
                disabled={!bothDeployed || busy === "send" || !text}
                className="flex-1"
              >
                {busy === "send" ? "Sending…" : `Send to ${destination.name}`}
              </Button>
            </div>
            {!bothDeployed ? (
              <p className="text-muted-foreground text-xs">
                Deploy the messenger on both chains to enable sending.
              </p>
            ) : null}
            {sentHash ? (
              <p className="text-sm">
                ✓ Sent from {source.name}. Waiting for the relayer to deliver to{" "}
                {destination.name}…
                {destReceived?.message === text ? " arrived!" : ""}
              </p>
            ) : null}
          </section>
        </>
      )}

      {error ? <p className="text-muted-foreground text-sm break-all">{error}</p> : null}

      <p className="text-muted-foreground text-xs">
        Teleporter: <span className="font-mono">{shortenAddress(icm.teleporterMessenger, 6)}</span> ·
        destination blockchain ID:{" "}
        <span className="font-mono">{shortenAddress(blockchainIdOf(destination), 8)}</span>
      </p>
    </Shell>
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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={`${mono ? "font-mono" : ""} truncate text-sm`}>{value}</span>
    </div>
  );
}
