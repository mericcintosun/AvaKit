import { useCallback, useEffect, useRef, useState } from "react";
import { type DevnetAction, type DevnetStatus, type L1Info, streamAction } from "../api";
import { Dot } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { shortHex } from "../lib/utils";

function L1Card({ l1 }: { l1: L1Info }) {
  const state = l1.running ? "live" : l1.deployed ? "on" : "off";
  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Dot state={state} />
          <span className="font-mono text-sm font-semibold">{l1.name}</span>
        </div>
        <span className="text-muted-foreground text-xs">
          {l1.running ? "running" : l1.deployed ? "deployed" : "configured"}
        </span>
      </div>
      <div className="mt-3 space-y-2 text-xs">
        <Row k="Chain ID" v={l1.evmChainId != null ? String(l1.evmChainId) : "—"} />
        <Row k="Token" v={l1.token ?? "—"} />
        <Row k="ICM" v={l1.teleporterReady ? "✓ Teleporter" : "—"} />
        <Row k="Blockchain" v={shortHex(l1.blockchainId, 6)} />
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}

export function DevnetView({
  status,
  refresh,
  hasCli,
}: {
  status: DevnetStatus | null;
  refresh: () => void;
  hasCli: boolean;
}) {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const termRef = useRef<HTMLPreElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run to auto-scroll as the log grows
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [log]);

  const run = useCallback(
    (action: DevnetAction) => {
      if (busy) return;
      setBusy(true);
      setLog([`▸ ${action}`]);
      streamAction(
        action,
        (line) => setLog((l) => [...l, line]),
        (code) => {
          setLog((l) => [...l, code === 0 ? "✔ done" : `✖ exited (${code})`]);
          setBusy(false);
          refresh();
        },
      );
    },
    [busy, refresh],
  );

  const l1s = status?.l1s ?? [];

  return (
    <div className="flex flex-col gap-4">
      {l1s.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {l1s.map((l1) => (
            <L1Card key={l1.name} l1={l1} />
          ))}
        </div>
      ) : (
        <Card className="p-5">
          <p className="text-muted-foreground text-sm">
            No local L1s yet. Spin up a two-L1 ICM devnet — one command, with a relayer wired for
            you.
          </p>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy || !hasCli}
          onClick={() => {
            if (
              window.confirm(
                "Create two local L1s with ICM + a relayer? This runs avalanche-cli and can take a few minutes.",
              )
            )
              run("create-icm");
          }}
        >
          Spin up ICM devnet
        </Button>
        {l1s.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !hasCli}
            onClick={() => run(status?.running ? "stop" : "start")}
          >
            {status?.running ? "Stop network" : "Start network"}
          </Button>
        )}
      </div>

      {!hasCli && (
        <p className="text-muted-foreground text-xs">
          Install avalanche-cli (see Environment) to control devnets.
        </p>
      )}

      {log.length > 0 && (
        <pre
          ref={termRef}
          className="max-h-96 overflow-auto rounded-xl bg-black p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-neutral-200"
        >
          {log.join("\n")}
        </pre>
      )}
    </div>
  );
}
