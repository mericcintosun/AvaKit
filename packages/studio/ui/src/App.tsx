import { ArrowRight, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type DevnetAction,
  type DevnetStatus,
  type Inventory,
  type L1Info,
  streamAction,
  type ToolInfo,
} from "./api";
import { Badge, Dot } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardRow } from "./components/ui/card";
import { shortHex } from "./lib/utils";

function useTheme() {
  const [dark, setDark] = useState(
    () =>
      localStorage.getItem("theme") === "dark" ||
      (!localStorage.getItem("theme") && window.matchMedia("(prefers-color-scheme: dark)").matches),
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function ToolRow({ t }: { t: ToolInfo }) {
  return (
    <CardRow>
      <div className="flex min-w-0 items-center gap-2.5">
        <Dot state={t.installed ? "on" : "off"} />
        <span className="font-medium">{t.name}</span>
      </div>
      {t.installed ? (
        <span className="text-muted-foreground font-mono text-xs">{t.version ?? "installed"}</span>
      ) : (
        <span className="text-muted-foreground max-w-[60%] truncate font-mono text-[0.7rem]">
          {t.hint ? `install: ${t.hint}` : "not installed"}
        </span>
      )}
    </CardRow>
  );
}

function L1Card({ l1 }: { l1: L1Info }) {
  const state = l1.running ? "live" : l1.deployed ? "on" : "off";
  const status = l1.running ? "running" : l1.deployed ? "deployed" : "configured";
  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Dot state={state} />
          <span className="font-mono text-sm font-semibold">{l1.name}</span>
        </div>
        <span className="text-muted-foreground text-xs">{status}</span>
      </div>
      <div className="mt-3 space-y-2 text-xs">
        <KV k="Chain ID" v={l1.evmChainId != null ? String(l1.evmChainId) : "—"} />
        <KV k="Token" v={l1.token ?? "—"} />
        <KV k="ICM" v={l1.teleporterReady ? "✓ Teleporter" : "—"} />
        <KV k="Blockchain" v={shortHex(l1.blockchainId, 6)} />
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}

export function App() {
  const { dark, toggle } = useTheme();
  const [env, setEnv] = useState<Inventory | null>(null);
  const [status, setStatus] = useState<DevnetStatus | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const termRef = useRef<HTMLPreElement>(null);

  const hasCli = env?.tools.some((t) => t.name === "avalanche-cli" && t.installed) ?? false;

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api<DevnetStatus>("/api/devnet/status"));
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await api("/api/health");
        setEnv(await api<Inventory>("/api/env"));
        await refreshStatus();
        setOnline(true);
      } catch {
        setOnline(false);
      }
    })();
    const timer = setInterval(() => {
      if (!busy) void refreshStatus();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshStatus, busy]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run to auto-scroll when the log grows
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
          void refreshStatus();
        },
      );
    },
    [busy, refreshStatus],
  );

  if (online === false) {
    return (
      <Shell dark={dark} toggle={toggle} statusText="offline">
        <Card className="p-6">
          <p className="text-muted-foreground text-sm">Could not reach the Studio server.</p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell
      dark={dark}
      toggle={toggle}
      statusText={online ? "● live" : "connecting…"}
      cwd={env?.cwd}
    >
      {env && (
        <>
          <Section title="Toolchain">
            <Card>
              {env.tools.map((t) => (
                <ToolRow key={t.name} t={t} />
              ))}
            </Card>
          </Section>

          <Section title="Project">
            <Card>
              <CardRow>
                <div className="flex items-center gap-2.5">
                  <Dot state={env.project.isAvaKit ? "on" : "off"} />
                  <span className="font-medium">
                    {env.project.name ?? "(no package.json here)"}
                  </span>
                </div>
                <span className="text-muted-foreground font-mono text-xs">
                  {env.project.isAvaKit ? "AvaKit project" : "not an AvaKit project"}
                </span>
              </CardRow>
              {env.project.template && (
                <CardRow>
                  <span className="font-medium">Template</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {env.project.template}
                  </span>
                </CardRow>
              )}
              <CardRow>
                <span className="font-medium">Contracts</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {env.project.hasContracts ? "Foundry ✓" : "—"}
                </span>
              </CardRow>
            </Card>
          </Section>
        </>
      )}

      <Section
        title="Devnet"
        right={<Badge>{status?.running ? "● network up" : "network down"}</Badge>}
      >
        {status && status.l1s.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {status.l1s.map((l1) => (
              <L1Card key={l1.name} l1={l1} />
            ))}
          </div>
        ) : (
          <Card className="p-4">
            <p className="text-muted-foreground text-sm">
              No local L1s yet. Spin up a two-L1 ICM devnet below.
            </p>
          </Card>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
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
          {status && status.l1s.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !hasCli}
              onClick={() => run(status.running ? "stop" : "start")}
            >
              {status.running ? "Stop network" : "Start network"}
            </Button>
          )}
          {status?.running && (
            <span className="text-muted-foreground ml-auto flex items-center gap-1 font-mono text-xs">
              chain1 <ArrowRight className="size-3" /> chain2 ready for ICM
            </span>
          )}
        </div>

        {!hasCli && (
          <p className="text-muted-foreground mt-3 text-xs">
            Install avalanche-cli (see Toolchain) to control devnets.
          </p>
        )}

        {log.length > 0 && (
          <pre
            ref={termRef}
            className="mt-3 max-h-80 overflow-auto rounded-lg bg-black p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-neutral-200"
          >
            {log.join("\n")}
          </pre>
        )}
      </Section>
    </Shell>
  );
}

function Shell({
  dark,
  toggle,
  statusText,
  cwd,
  children,
}: {
  dark: boolean;
  toggle: () => void;
  statusText: string;
  cwd?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">AvaKit Studio</h1>
        <div className="flex items-center gap-2">
          <Badge>{statusText}</Badge>
          <Button variant="outline" size="icon" aria-label="Toggle theme" onClick={toggle}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </header>
      <p className="text-muted-foreground mt-1.5 mb-10 text-sm">
        Local control center for Avalanche development — L1s, Interchain Messaging, and devnets.
      </p>
      {children}
      {cwd && <p className="text-muted-foreground mt-12 font-mono text-xs">{cwd}</p>}
    </div>
  );
}
