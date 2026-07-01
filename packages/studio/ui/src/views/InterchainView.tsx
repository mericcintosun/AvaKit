import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, apiPost, type IcmChain, type IcmState } from "../api";
import { CopyButton } from "../components/copy-button";
import { useToast } from "../components/toast";
import { Dot } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { shortHex } from "../lib/utils";

type InFlight = { message: string; to: string };

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
  const [from, setFrom] = useState("");
  const [msg, setMsg] = useState("gm from the other chain");
  const [inFlight, setInFlight] = useState<InFlight | null>(null);

  const chains = icm?.chains ?? [];
  const bothDeployed = chains.length >= 2 && chains.every((c) => c.messenger);
  const source = chains.find((c) => c.name === from) ?? chains[0];
  const destination = chains.find((c) => c.name !== source?.name);

  const refresh = useCallback(async () => {
    try {
      const next = await api<IcmState>("/api/icm/state");
      setIcm(next);
      setFrom((f) => f || next.chains[0]?.name || "");
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
    if (dest?.lastMessage === inFlight.message) {
      toast({
        title: "Delivered",
        description: `“${inFlight.message}” arrived on ${inFlight.to}.`,
        variant: "success",
      });
      setInFlight(null);
    }
  }, [icm, inFlight, toast]);

  const deploy = useCallback(async () => {
    setBusy("deploy");
    try {
      setIcm(await apiPost<IcmState>("/api/icm/deploy"));
      toast({
        title: "Messengers deployed",
        description: "One on each L1. Now send a message.",
        variant: "success",
      });
    } catch (e) {
      toast({
        title: "Deploy failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setBusy(null);
    }
  }, [toast]);

  const send = useCallback(async () => {
    if (!source || !destination) return;
    setBusy("send");
    try {
      await apiPost("/api/icm/send", { from: source.name, to: destination.name, message: msg });
      setInFlight({ message: msg, to: destination.name });
      toast({
        title: "Message sent",
        description: `Relayer is delivering to ${destination.name}…`,
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
  }, [source, destination, msg, refresh, toast]);

  if (!icm?.ready) {
    return (
      <Card className="p-5">
        <p className="text-sm font-medium">No running devnet</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Go to <span className="font-medium">Devnet</span> and spin up (or start) a network with
          two L1s — then come back here to send a message across chains.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {chains.map((c) => (
          <MessengerCard key={c.name} chain={c} incoming={c.name === inFlight?.to} />
        ))}
      </div>

      {!bothDeployed ? (
        <Card className="flex flex-col gap-3 p-5">
          <div>
            <p className="text-sm font-medium">Deploy the messenger</p>
            <p className="text-muted-foreground mt-1 text-sm">
              One <span className="font-mono">AvaKitMessenger</span> per L1 — it both sends and
              receives. Studio deploys it for you with the local dev key.
            </p>
          </div>
          <Button size="sm" disabled={busy === "deploy"} onClick={deploy} className="self-start">
            {busy === "deploy" ? "Deploying…" : "Deploy messengers on both chains"}
          </Button>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3 p-5">
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <span className="font-mono">{source?.name}</span>
            <ArrowRight className="size-3" />
            <span className="font-mono">{destination?.name}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder="Message to send cross-chain"
              className="border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-2 text-sm outline-none"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "send"}
              onClick={() => {
                if (!source || !destination) return;
                setFrom(destination.name);
                toast({
                  title: "Direction swapped",
                  description: `${destination.name} → ${source.name}`,
                  variant: "info",
                });
              }}
            >
              Swap
            </Button>
            <Button size="sm" disabled={busy === "send" || !msg} onClick={send}>
              {busy === "send" ? "Sending…" : "Send"}
            </Button>
          </div>
          {inFlight && (
            <p className="flex items-center gap-2 text-sm">
              <span className="bg-foreground size-2 animate-ping rounded-full" />
              Relayer delivering “{inFlight.message}” to {inFlight.to}…
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
