"use client";

import {
  deployContract,
  ensureChain,
  getPublicClient,
  getWalletClient,
  readContract,
} from "@avakit/core";
import type { AvaChain } from "@avakit/core/chains";
import {
  Button,
  ConnectAvalanche,
  humanizeError,
  shortenAddress,
  useAvaAccount,
  useAvaChain,
  useAvaKit,
} from "@avakit/react";
import { ArrowRight, Check, Copy, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { type DeployedContract, useDeployedContract } from "@/lib/deployed-contract";
import { blockchainIdOf, chain1, chain2, icm, isConfigured } from "@/lib/devnet";
import { abi, bytecode } from "@/lib/messenger-artifact";

// Where each chain's deployed messenger is remembered in localStorage. The
// address is stored per chain instance and re-verified on load, so one left
// over from before a devnet reset is never used (see lib/deployed-contract.ts).
const MESSENGER_STORAGE_KEY = "icm-messenger:messenger";
const CHAINS: [AvaChain, AvaChain] = [chain1, chain2];

type ChainStatus = { online: boolean; block: bigint; icmReady: boolean };
type Inbox = { message: string; count: bigint };

/** Re-verify a remembered contract when its chain comes back after being unreachable. */
function useRecheckWhenOnline(contract: DeployedContract, online: boolean) {
  const { status, recheck } = contract;
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && status === "unreachable") recheck();
    wasOnline.current = online;
  }, [online, status, recheck]);
}

export function Demo() {
  const { address, isConnected } = useAvaAccount();
  const { provider } = useAvaKit();
  const { setChain } = useAvaChain();

  const messenger1 = useDeployedContract(MESSENGER_STORAGE_KEY, chain1);
  const messenger2 = useDeployedContract(MESSENGER_STORAGE_KEY, chain2);
  const addr1 = messenger1.address;
  const addr2 = messenger2.address;
  const [status, setStatus] = useState<Record<number, ChainStatus>>({});
  const [inbox, setInbox] = useState<Record<number, Inbox>>({});
  const [linked, setLinked] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState("gm from the other chain");
  const [source, setSource] = useState<AvaChain>(chain1);
  const [inFlight, setInFlight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const destination = source.id === chain1.id ? chain2 : chain1;
  const messengerOf = (chain: AvaChain) => (chain.id === chain1.id ? messenger1 : messenger2);
  const bothDeployed = Boolean(addr1 && addr2);
  const bothLinked = Boolean(linked[chain1.id] && linked[chain2.id]);

  // A messenger that could not be verified because its chain was down is
  // checked again as soon as the chain answers (e.g. after `avalanche network start`).
  useRecheckWhenOnline(messenger1, status[chain1.id]?.online ?? false);
  useRecheckWhenOnline(messenger2, status[chain2.id]?.online ?? false);

  // Live poll: chain liveness (block height), ICM readiness (Teleporter has
  // code), each deployed messenger's inbox, and whether it trusts the other
  // side's messenger (the link). Read-only — no wallet needed.
  useEffect(() => {
    if (!isConfigured) return;
    let active = true;
    const deployed: Record<number, Address | null> = { [chain1.id]: addr1, [chain2.id]: addr2 };
    async function poll() {
      const nextStatus: Record<number, ChainStatus> = {};
      const nextInbox: Record<number, Inbox> = {};
      const nextLinked: Record<number, boolean> = {};
      await Promise.all(
        CHAINS.map(async (chain) => {
          const client = getPublicClient(chain);
          try {
            const [block, code] = await Promise.all([
              client.getBlockNumber(),
              client.getCode({ address: icm.teleporterMessenger as Address }),
            ]);
            nextStatus[chain.id] = { online: true, block, icmReady: Boolean(code && code !== "0x") };
          } catch {
            nextStatus[chain.id] = { online: false, block: 0n, icmReady: false };
          }
          const messenger = deployed[chain.id];
          if (messenger) {
            const other = chain.id === chain1.id ? chain2 : chain1;
            const otherMessenger = deployed[other.id];
            try {
              const [message, count, peer] = await Promise.all([
                readContract(chain, { address: messenger, abi, functionName: "lastMessage" }),
                readContract(chain, { address: messenger, abi, functionName: "messagesReceived" }),
                readContract(chain, {
                  address: messenger,
                  abi,
                  functionName: "trustedRemote",
                  args: [blockchainIdOf(other)],
                }),
              ]);
              nextInbox[chain.id] = { message: message as string, count: count as bigint };
              nextLinked[chain.id] = Boolean(
                otherMessenger &&
                  (peer as string).toLowerCase() === otherMessenger.toLowerCase(),
              );
            } catch {
              // the chain did not answer this round; the next poll tries again
            }
          }
        }),
      );
      if (active) {
        setStatus(nextStatus);
        setInbox(nextInbox);
        setLinked(nextLinked);
      }
    }
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [addr1, addr2]);

  // Clear the in-flight banner once the destination inbox shows the message.
  useEffect(() => {
    if (inFlight && inbox[destination.id]?.message === inFlight) setInFlight(null);
  }, [inFlight, inbox, destination.id]);

  const remember1 = messenger1.remember;
  const remember2 = messenger2.remember;
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
          // The messenger takes its chain's TeleporterMessenger address as a
          // constructor argument (it is immutable, not hardcoded).
          args: [icm.teleporterMessenger as Address],
          chain,
          provider,
          account: address,
        });
        (chain.id === chain1.id ? remember1 : remember2)(deployed);
      } catch (e) {
        setError(humanizeError(e));
      } finally {
        setBusy(null);
      }
    },
    [provider, address, remember1, remember2, setChain],
  );

  // Register each messenger as the other one's trusted remote — one
  // setTrustedRemote transaction per chain. Receiving rejects any source that
  // is not registered, so sending only works after this step.
  const linkChains = useCallback(async () => {
    if (!provider || !address) return;
    if (!addr1 || !addr2) return;
    setBusy("link");
    setError(null);
    try {
      const legs = [
        { chain: chain1, own: addr1, other: chain2, otherAddr: addr2 },
        { chain: chain2, own: addr2, other: chain1, otherAddr: addr1 },
      ];
      for (const leg of legs) {
        if (linked[leg.chain.id]) continue; // already trusts the other side
        await ensureChain(provider, leg.chain);
        setChain(leg.chain);
        const wallet = getWalletClient(leg.chain, provider);
        await wallet.writeContract({
          address: leg.own,
          abi,
          functionName: "setTrustedRemote",
          args: [blockchainIdOf(leg.other), leg.otherAddr],
          account: address,
        } as never);
      }
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  }, [provider, address, addr1, addr2, linked, setChain]);

  const sendMessage = useCallback(async () => {
    if (!provider || !address) return;
    const from = source.id === chain1.id ? addr1 : addr2;
    const to = destination.id === chain1.id ? addr1 : addr2;
    if (!from || !to) return;
    setBusy("send");
    setError(null);
    try {
      await ensureChain(provider, source);
      setChain(source);
      const wallet = getWalletClient(source, provider);
      await wallet.writeContract({
        address: from,
        abi,
        functionName: "sendMessage",
        args: [blockchainIdOf(destination), to, text],
        account: address,
      } as never);
      setInFlight(text);
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  }, [provider, address, addr1, addr2, source, destination, text, setChain]);

  if (!isConfigured) {
    return (
      <Shell>
        <SetupPanel />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Devnet Studio</h1>
        <p className="text-muted-foreground text-sm">
          Two Avalanche L1s, live. Deploy the messenger on each, link them, then send a message
          across — Interchain Messaging carries it and you watch it land on the other chain.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CHAINS.map((chain) => (
          <ChainCard
            key={chain.id}
            chain={chain}
            status={status[chain.id]}
            messenger={messengerOf(chain)}
            inbox={inbox[chain.id]}
            linked={linked[chain.id]}
            isDestination={inFlight != null && chain.id === destination.id}
            busy={busy === `deploy:${chain.id}`}
            canDeploy={isConnected && !!address}
            locked={busy !== null}
            onDeploy={() => deployOn(chain)}
          />
        ))}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border p-6">
        <div className="flex items-center justify-between">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <span className="font-mono">{source.name}</span>
            <ArrowRight className="size-4" />
            <span className="font-mono">{destination.name}</span>
          </div>
          {!isConnected || !address ? <ConnectAvalanche /> : null}
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
            disabled={!bothDeployed || !bothLinked || !isConnected || busy === "send" || !text}
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
        {bothDeployed && !bothLinked ? (
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              onClick={linkChains}
              disabled={!isConnected || busy === "link"}
            >
              {busy === "link" ? "Linking…" : "Link the messengers"}
            </Button>
            <p className="text-muted-foreground text-xs">
              Each side registers the other as its trusted remote — two transactions, one per
              chain. Receiving rejects unregistered sources, so this unlocks sending.
            </p>
          </div>
        ) : null}
        {inFlight ? (
          <p className="flex items-center gap-2 text-sm">
            <span className="bg-foreground size-2 animate-ping rounded-full" />
            In flight to {destination.name} — the relayer is delivering “{inFlight}”…
          </p>
        ) : null}
      </section>

      {error ? <p className="text-muted-foreground text-sm break-all">{error}</p> : null}
    </Shell>
  );
}

function ChainCard({
  chain,
  status,
  messenger,
  inbox,
  linked,
  isDestination,
  busy,
  canDeploy,
  locked,
  onDeploy,
}: {
  chain: AvaChain;
  status?: ChainStatus;
  messenger: DeployedContract;
  inbox?: Inbox;
  linked?: boolean;
  isDestination: boolean;
  busy: boolean;
  canDeploy: boolean;
  /** True while a transaction is in progress, so the messenger cannot be swapped under it. */
  locked: boolean;
  onDeploy: () => void;
}) {
  const online = status?.online ?? false;
  const address = messenger.address;
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-5 transition-colors ${
        isDestination ? "border-foreground" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold">{chain.name}</span>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <span
            className={`size-2 rounded-full ${online ? "bg-foreground animate-pulse" : "bg-muted-foreground/40"}`}
          />
          {online ? `block ${status?.block ?? 0n}` : "offline"}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <Row label="Chain ID" value={String(chain.id)} mono />
        <Row
          label="ICM"
          value={status?.icmReady ? "✓ Teleporter ready" : "—"}
          mono
        />
        {address ? <Row label="Messenger" value={shortenAddress(address, 6)} mono /> : null}
        {address ? <Row label="Peer" value={linked ? "✓ trusted" : "not linked"} mono /> : null}
      </div>

      {address ? (
        <>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-muted-foreground text-xs">Last received</p>
            <p className="truncate text-sm">{inbox?.message || "—"}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {inbox?.count ? `${inbox.count} total` : "0 total"}
            </p>
          </div>
          {/* Forgets this messenger (it stays on-chain) so a new one can be
              deployed, e.g. after editing the contract. The new one has to be
              linked again. */}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground self-start"
            onClick={messenger.forget}
            disabled={locked}
          >
            Deploy a new one
          </Button>
        </>
      ) : messenger.status === "checking" ? (
        <p className="text-muted-foreground text-xs">Looking for your deployed messenger…</p>
      ) : messenger.status === "unreachable" ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted-foreground text-xs">
            This chain is not answering, so your messenger could not be checked. Start the devnet,
            then try again.
          </p>
          <Button variant="outline" size="sm" onClick={messenger.recheck}>
            Try again
          </Button>
        </div>
      ) : (
        <Button onClick={onDeploy} disabled={busy || !canDeploy} size="sm">
          {busy ? "Deploying…" : "Deploy messenger"}
        </Button>
      )}
    </div>
  );
}

function SetupPanel() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border p-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Spin up your cross-chain devnet</h1>
        <p className="text-muted-foreground text-sm">
          This app sends a message between two Avalanche L1s. Bring them up — with Interchain
          Messaging and a relayer wired automatically — with one command in your terminal:
        </p>
      </div>
      <CopyCommand command="pnpm devnet" />
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
        . When it finishes it writes <span className="font-mono">icm.config.json</span> and this page
        turns into the Devnet Studio automatically.
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
