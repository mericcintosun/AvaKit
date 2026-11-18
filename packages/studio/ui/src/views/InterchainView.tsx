import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, apiPost, type IcmChain, type IcmSendResult, type IcmState } from "../api";
import { CopyButton } from "../components/copy-button";
import { useToast } from "../components/toast";
import { Dot } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { NativeSelect } from "../components/ui/native-select";
import {
  DELIVERY_TIMEOUT_MS,
  hasArrived,
  messageBytes,
  messageProblem,
  overdueIn,
  type Pair,
  resolvePair,
  withFrom,
  withTo,
} from "../lib/interchain";
import { shortHex } from "../lib/utils";

/** A message that was sent on the source chain and is awaited on the destination. */
type InFlight = { message: string; to: string; receivedBefore: number | null; sentAt: number };

function MessengerCard({ chain, incoming }: { chain: IcmChain; incoming: boolean }) {
  return (
    <div className={`bg-card rounded-xl border p-4 ${incoming ? "border-foreground" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Dot state={chain.running ? "live" : "off"} />
          <span className="font-mono text-sm font-semibold">{chain.name}</span>
        </div>
        <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
          {chain.messenger ? shortHex(chain.messenger, 5) : "not deployed"}
          {chain.messenger && <CopyButton value={chain.messenger} label="" />}
        </span>
      </div>
      <div className="bg-muted/50 mt-3 rounded-lg p-3">
        <p className="text-muted-foreground text-xs">Last received</p>
        <p className="truncate text-sm">{chain.lastMessage || "—"}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {chain.messagesReceived ? `${chain.messagesReceived} total` : "0 total"}
        </p>
      </div>
    </div>
  );
}

export function InterchainView() {
  const toast = useToast();
  const [icm, setIcm] = useState<IcmState | null>(null);
  const [busy, setBusy] = useState<null | "deploy" | "send">(null);
  const [picked, setPicked] = useState<Partial<Pair>>({});
  const [msg, setMsg] = useState("gm from the other chain");
  const [inFlight, setInFlight] = useState<InFlight | null>(null);
  const [overdue, setOverdue] = useState(false);

  // The server lists only running, Teleporter-ready local L1s. Any two of them
  // that have a messenger can exchange a message; the rest still need a deploy.
  const chains = icm?.chains ?? [];
  const missing = chains.filter((c) => !c.messenger);
  const sendable = chains.filter((c) => c.messenger);
  const pair = resolvePair(
    sendable.map((c) => c.name),
    picked,
  );
  const from = pair?.from ?? null;
  const to = pair?.to ?? null;

  const refresh = useCallback(async () => {
    try {
      setIcm(await api<IcmState>("/api/icm/state"));
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!busy) void refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [refresh, busy]);

  // Toast + clear once the message lands on the destination.
  useEffect(() => {
    if (!inFlight || !icm) return;
    const dest = icm.chains.find((c) => c.name === inFlight.to);
    if (dest && hasArrived(inFlight, dest)) {
      toast({
        title: "Delivered",
        description: `“${inFlight.message}” arrived on ${inFlight.to}.`,
        variant: "success",
      });
      setInFlight(null);
    }
  }, [icm, inFlight, toast]);

  // A successful send only puts the message on the source chain. If it has not
  // arrived after a while, stop saying "delivering" and say so instead — a late
  // arrival is still picked up by the effect above.
  useEffect(() => {
    setOverdue(false);
    if (!inFlight) return;
    const timer = setTimeout(() => setOverdue(true), overdueIn(inFlight.sentAt, Date.now()));
    return () => clearTimeout(timer);
  }, [inFlight]);

  // Deploys what is missing and links the messengers; with nothing missing
  // (`linkOnly`) the same call just links them.
  const deploy = useCallback(
    async (linkOnly = false) => {
      setBusy("deploy");
      try {
        setIcm(await apiPost<IcmState>("/api/icm/deploy"));
        toast({
          title: linkOnly ? "Messengers linked" : "Messengers deployed",
          description: linkOnly
            ? "They accept each other's messages now. Send one."
            : "One on each L1, linked to each other. Now send a message.",
          variant: "success",
        });
      } catch (e) {
        toast({
          title: linkOnly ? "Linking failed" : "Deploy failed",
          description: e instanceof Error ? e.message : String(e),
          variant: "error",
        });
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const send = useCallback(async () => {
    if (!from || !to) return;
    setBusy("send");
    try {
      const sent = await apiPost<IcmSendResult>("/api/icm/send", { from, to, message: msg });
      setInFlight({
        message: msg,
        to,
        receivedBefore: sent.receivedBefore,
        sentAt: Date.now(),
      });
      toast({
        title: "Message sent",
        description: `Relayer is delivering to ${to}…`,
        variant: "info",
      });
    } catch (e) {
      toast({
        title: "Send failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setBusy(null);
      void refresh();
    }
  }, [from, to, msg, refresh, toast]);

  if (!icm) {
    return (
      <Card className="p-5">
        <p className="text-muted-foreground text-sm">Looking for running L1s…</p>
      </Card>
    );
  }

  // `hasPeers`, not `ready`: two running L1s are enough to deploy messengers
  // here; `ready` only holds once they are deployed and linked.
  if (!icm.hasPeers) {
    return (
      <Card className="p-5">
        <p className="text-sm font-medium">No running devnet</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {chains.length === 1 ? (
            <>
              Only <span className="font-mono">{chains[0]?.name}</span> is running with Interchain
              Messaging — a message needs two L1s.{" "}
            </>
          ) : null}
          Go to <span className="font-medium">Devnet</span> and spin up (or start) a network with
          two L1s — then come back here to send a message across chains.
        </p>
      </Card>
    );
  }

  const problem = messageProblem(msg, icm.maxMessageBytes);
  const deployLabel =
    chains.length === 2 && missing.length === 2
      ? "Deploy messengers on both chains"
      : `Deploy the messenger on ${missing.map((c) => c.name).join(", ")}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {chains.map((c) => (
          <MessengerCard key={c.name} chain={c} incoming={c.name === inFlight?.to} />
        ))}
      </div>

      {missing.length > 0 && (
        <Card className="flex flex-col gap-3 p-5">
          <div>
            <p className="text-sm font-medium">Deploy the messenger</p>
            <p className="text-muted-foreground mt-1 text-sm">
              One <span className="font-mono">AvaKitMessenger</span> per L1 — it both sends and
              receives. Studio deploys it for you with the local dev key, and links the messengers
              so they accept each other's messages. A messenger that went with a wiped devnet, or
              that an older Studio deployed, is replaced.
            </p>
          </div>
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() => void deploy()}
            className="self-start"
          >
            {busy === "deploy" ? "Deploying…" : deployLabel}
          </Button>
        </Card>
      )}

      {missing.length === 0 && !icm.ready && (
        <Card className="flex flex-col gap-3 p-5">
          <div>
            <p className="text-sm font-medium">Link the messengers</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Every L1 has a messenger, but no two of them accept each other's messages yet. A send
              links the one direction it needs by itself; linking them here does it for every pair,
              both ways.
            </p>
          </div>
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() => void deploy(true)}
            className="self-start"
          >
            {busy === "deploy" ? "Linking…" : "Link messengers"}
          </Button>
        </Card>
      )}

      {pair && (
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label="Source chain"
              value={pair.from}
              disabled={busy === "send"}
              onChange={(e) => setPicked(withFrom(pair, e.target.value))}
            >
              {sendable.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <ArrowRight className="text-muted-foreground size-4" aria-hidden="true" />
            <NativeSelect
              aria-label="Destination chain"
              value={pair.to}
              disabled={busy === "send"}
              onChange={(e) => setPicked(withTo(pair, e.target.value))}
            >
              {sendable.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "send"}
              onClick={() => setPicked({ from: pair.to, to: pair.from })}
            >
              Swap
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder="Message to send cross-chain"
              aria-label="Message"
              aria-invalid={problem !== null && msg !== ""}
              className="border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-2 text-sm outline-none"
            />
            <Button size="sm" disabled={busy !== null || problem !== null} onClick={send}>
              {busy === "send" ? "Sending…" : "Send"}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {problem && msg !== ""
              ? problem
              : `${messageBytes(msg)} / ${icm.maxMessageBytes} bytes`}
          </p>
          {inFlight && !overdue && (
            <p className="flex items-center gap-2 text-sm">
              <span className="bg-foreground size-2 animate-ping rounded-full" />
              Relayer delivering “{inFlight.message}” to {inFlight.to}…
            </p>
          )}
          {inFlight && overdue && (
            <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-3">
              <p className="text-sm font-medium">Not delivered to {inFlight.to} yet</p>
              <p className="text-muted-foreground text-xs break-words">
                “{inFlight.message}” was sent, but {inFlight.to} has not received it after{" "}
                {DELIVERY_TIMEOUT_MS / 1000} seconds. The relayer may not be running — it starts
                with the ICM devnet (check{" "}
                <span className="font-mono">avalanche network status</span>). If it still arrives,
                it will show up on {inFlight.to}'s card above.
              </p>
              <Button size="sm" variant="ghost" onClick={() => setInFlight(null)}>
                Dismiss
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
