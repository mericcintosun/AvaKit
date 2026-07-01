import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, apiPost, type IcmChain, type IcmState } from "../api";
import { Dot } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { shortHex } from "../lib/utils";

function MessengerCard({ chain, incoming }: { chain: IcmChain; incoming: boolean }) {
  return (
    <div className={`bg-card rounded-xl border p-4 ${incoming ? "border-foreground" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Dot state={chain.running ? "live" : "off"} />
          <span className="font-mono text-sm font-semibold">{chain.name}</span>
        </div>
        <span className="text-muted-foreground font-mono text-xs">
          {chain.messenger ? shortHex(chain.messenger, 5) : "not deployed"}
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
  const [icm, setIcm] = useState<IcmState | null>(null);
  const [busy, setBusy] = useState<null | "deploy" | "send">(null);
  const [from, setFrom] = useState("");
  const [msg, setMsg] = useState("gm from the other chain");
  const [inFlight, setInFlight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chains = icm?.chains ?? [];
  const bothDeployed = chains.length >= 2 && chains.every((c) => c.messenger);
  const source = chains.find((c) => c.name === from) ?? chains[0];
  const destination = chains.find((c) => c.name !== source?.name);

  const refresh = useCallback(async () => {
    try {
      const next = await api<IcmState>("/api/icm/state");
      setIcm(next);
      setFrom((f) => f || next.chains[0]?.name || "");
      setInFlight((flight) =>
        flight && next.chains.some((c) => c.lastMessage === flight) ? null : flight,
      );
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

  const deploy = useCallback(async () => {
    setBusy("deploy");
    setError(null);
    try {
      setIcm(await apiPost<IcmState>("/api/icm/deploy"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const send = useCallback(async () => {
    if (!source || !destination) return;
    setBusy("send");
    setError(null);
    try {
      await apiPost("/api/icm/send", { from: source.name, to: destination.name, message: msg });
      setInFlight(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      void refresh();
    }
  }, [source, destination, msg, refresh]);

  if (!icm?.ready) {
    return (
      <Card className="p-5">
        <p className="text-muted-foreground text-sm">
          Start a running devnet with two L1s (in Devnet) to send a message across chains.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {chains.map((c) => (
          <MessengerCard
            key={c.name}
            chain={c}
            incoming={inFlight != null && c.name === destination?.name}
          />
        ))}
      </div>

      {!bothDeployed ? (
        <Button size="sm" disabled={busy === "deploy"} onClick={deploy}>
          {busy === "deploy" ? "Deploying messengers…" : "Deploy messengers on both chains"}
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
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
              onClick={() => setFrom(destination?.name ?? "")}
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
              Relayer delivering “{inFlight}” to {destination?.name}…
            </p>
          )}
        </div>
      )}

      {error && <p className="text-muted-foreground text-sm break-all">{error}</p>}
    </div>
  );
}
