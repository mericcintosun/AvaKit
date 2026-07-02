import { ArrowRight, Eraser, Rocket, Terminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DevnetAction,
  type DevnetStatus,
  type L1Info,
  type L1Params,
  streamAction,
} from "../api";
import { CopyButton } from "../components/copy-button";
import type { View } from "../components/Sidebar";
import { useToast } from "../components/toast";
import { Dot } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { shortHex } from "../lib/utils";

const DONE_TOAST: Record<DevnetAction, { title: string; description: string }> = {
  "create-icm": {
    title: "Devnet is ready",
    description:
      "Two L1s are running with ICM and a relayer. Head to Interchain to send a message.",
  },
  "create-l1": {
    title: "Your L1 is live",
    description: "It's deployed locally. Its RPC is on the card above — point a dapp at it.",
  },
  start: { title: "Network started", description: "Your local L1s are back up." },
  stop: { title: "Network stopped", description: "State is preserved — start it again anytime." },
};

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
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Blockchain</span>
          <span className="flex items-center gap-1.5 font-mono">
            {shortHex(l1.blockchainId, 6)}
            {l1.blockchainId && <CopyButton value={l1.blockchainId} label="" />}
          </span>
        </div>
        {l1.rpcUrl && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">RPC</span>
            <span className="flex items-center gap-1.5">
              <CopyButton value={l1.rpcUrl} label="Copy" />
            </span>
          </div>
        )}
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

function Field({
  label,
  value,
  ok,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  ok: boolean;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`bg-background rounded-lg border px-3 py-1.5 font-mono text-sm outline-none ${
          value && !ok ? "border-destructive" : ""
        }`}
      />
    </label>
  );
}

export function DevnetView({
  status,
  refresh,
  hasCli,
  navigate,
}: {
  status: DevnetStatus | null;
  refresh: () => void;
  hasCli: boolean;
  navigate: (v: View) => void;
}) {
  const toast = useToast();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "mychain", chainId: "9999", token: "MYL1" });
  const termRef = useRef<HTMLPreElement>(null);

  const nameOk = /^[a-z][a-z0-9]{1,31}$/.test(form.name);
  const chainIdOk = /^[1-9][0-9]{0,9}$/.test(form.chainId) && Number(form.chainId) <= 4294967295;
  const tokenOk = /^[A-Z][A-Z0-9]{0,7}$/.test(form.token);
  const formOk = nameOk && chainIdOk && tokenOk;

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run to auto-scroll as the log grows
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [log]);

  const run = useCallback(
    (action: DevnetAction, params?: L1Params) => {
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
          if (code === 0) toast({ ...DONE_TOAST[action], variant: "success" });
          else
            toast({
              title: "Something went wrong",
              description: "See the console below for the full output.",
              variant: "error",
            });
        },
        params,
      );
    },
    [busy, refresh, toast],
  );

  const l1s = status?.l1s ?? [];
  const live = Boolean(status?.running) && l1s.filter((l) => l.running).length >= 2;

  return (
    <div className="flex flex-col gap-4">
      {live && (
        <div className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <div className="flex items-center gap-2.5">
            <Dot state="live" />
            <p className="text-sm font-medium">Your devnet is live.</p>
            <span className="text-muted-foreground text-sm">
              Two L1s with a relayer — ready for a cross-chain message.
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate("interchain")}>
            Send a message <ArrowRight className="size-4" />
          </Button>
        </div>
      )}

      {l1s.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {l1s.map((l1) => (
            <L1Card key={l1.name} l1={l1} />
          ))}
        </div>
      ) : (
        <Card className="p-5">
          <p className="text-sm font-medium">No local L1s yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            “Spin up ICM devnet” creates two Avalanche L1s with Interchain Messaging and a relayer,
            all locally. First run downloads avalanchego, so it can take a few minutes — watch the
            console below.
          </p>
        </Card>
      )}

      {/* Launch your own single L1 */}
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Rocket className="size-4" />
          <p className="text-sm font-medium">Launch your own L1</p>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Spin up a single Subnet-EVM chain, locally, in one click. Point any dapp at the RPC it
          gives you.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field
            label="Name"
            value={form.name}
            ok={nameOk}
            placeholder="mychain"
            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
          />
          <Field
            label="Chain ID"
            value={form.chainId}
            ok={chainIdOk}
            placeholder="9999"
            onChange={(v) => setForm((f) => ({ ...f, chainId: v }))}
          />
          <Field
            label="Token"
            value={form.token}
            ok={tokenOk}
            placeholder="MYL1"
            onChange={(v) => setForm((f) => ({ ...f, token: v.toUpperCase() }))}
          />
        </div>
        <Button
          size="sm"
          className="mt-3"
          disabled={busy || !hasCli || !formOk}
          onClick={() => {
            if (
              window.confirm(
                `Create and deploy L1 “${form.name}” (chain ${form.chainId}) locally? This runs avalanche-cli and can take a few minutes.`,
              )
            )
              run("create-l1", { name: form.name, chainId: form.chainId, token: form.token });
          }}
        >
          <Rocket className="size-4" />
          {busy ? "Working…" : "Launch L1"}
        </Button>
        {!formOk && (
          <p className="text-muted-foreground mt-2 text-xs">
            name: lowercase letters/digits · chain ID: 1–4294967295 · token: 1–8 upper-case chars.
          </p>
        )}
      </Card>

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
          {busy ? "Working…" : "Spin up ICM devnet"}
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
        {busy && (
          <span className="text-muted-foreground text-xs">
            Running avalanche-cli — this can take a few minutes.
          </span>
        )}
      </div>

      {!hasCli && (
        <p className="text-muted-foreground text-xs">
          Install avalanche-cli (see Environment) to control devnets.
        </p>
      )}

      {log.length > 0 && (
        <div className="overflow-hidden rounded-xl border">
          <div className="bg-muted/40 flex items-center justify-between border-b px-3 py-2">
            <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
              <Terminal className="size-3.5" /> console
            </span>
            <div className="flex items-center gap-3">
              <CopyButton value={log.join("\n")} label="Copy" />
              <button
                type="button"
                onClick={() => setLog([])}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs disabled:opacity-40"
              >
                <Eraser className="size-3.5" /> Clear
              </button>
            </div>
          </div>
          <pre
            ref={termRef}
            className="max-h-96 overflow-auto bg-black p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-neutral-200"
          >
            {log.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}
