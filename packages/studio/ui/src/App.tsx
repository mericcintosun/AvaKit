import { FlaskConical, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DevnetStatus, type IcmState, type Inventory } from "./api";
import { BootSplash } from "./components/BootSplash";
import { Sidebar, type View } from "./components/Sidebar";
import { useToast } from "./components/toast";
import { Badge, Dot } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { useFujiWizard } from "./hooks/useFujiWizard";
import { type Connection, connectionAfterFailure, connectionLabel } from "./lib/connection";
import { EXPERIMENTAL_NOTE, isExperimental } from "./lib/experimental";
import { countPeers } from "./lib/interchain";
import { finishNotice, runHome, runLabel } from "./lib/run-messages";
import { useRunStatus } from "./run";
import { DataPanel } from "./views/DataView";
import { DevnetView } from "./views/DevnetView";
import { EnvironmentView } from "./views/EnvironmentView";
import { FujiView } from "./views/FujiView";
import { InterchainView } from "./views/InterchainView";
import { OverviewView } from "./views/OverviewView";

const TITLES: Record<View, { title: string; sub: string }> = {
  overview: {
    title: "Overview",
    sub: "Your Avalanche dev environment, local devnets, and Interchain Messaging — at a glance.",
  },
  devnet: {
    title: "Devnet",
    sub: "Spin up local L1s with Interchain Messaging and a relayer, and start or stop the network.",
  },
  fuji: {
    title: "Launch on Fuji",
    sub: "Deploy your own sovereign L1 to the public Fuji testnet — funding, transfer, and deploy, step by step.",
  },
  interchain: {
    title: "Interchain Messaging",
    sub: "Deploy messengers and watch a message travel between two L1s.",
  },
  data: {
    title: "Data",
    sub: "Balances, NFTs, and transactions for any Fuji or C-Chain address — no indexer.",
  },
  environment: {
    title: "Environment",
    sub: "The Avalanche tools and project detected on this machine.",
  },
};

/** The note at the top of every view that drives Avalanche CLI. */
function ExperimentalNote() {
  return (
    <Card className="mb-4 flex items-start gap-3 p-4">
      <FlaskConical className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="text-sm">
        <p className="font-medium">Experimental</p>
        <p className="text-muted-foreground mt-0.5">{EXPERIMENTAL_NOTE}</p>
      </div>
    </Card>
  );
}

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

export function App() {
  const { dark, toggle } = useTheme();
  const toast = useToast();
  const [env, setEnv] = useState<Inventory | null>(null);
  const [status, setStatus] = useState<DevnetStatus | null>(null);
  const [icm, setIcm] = useState<IcmState | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const envLoaded = useRef(false);
  const [view, setView] = useState<View>("overview");

  // State that must outlive a view lives here, above the view switch: the
  // avalanche-cli action in flight (run store) and the Fuji wizard's progress.
  const { run, busy, lost, onFinished } = useRunStatus();
  const wizard = useFujiWizard(run, view === "fuji");

  // Every poll decides the connection state afresh — not just the first one —
  // so a Studio that was stopped (or restarted, with a new session token) shows
  // as such within one poll interval instead of "connected" until a click fails.
  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api<DevnetStatus>("/api/devnet/status"));
      setConnection("online");
      // The environment does not change while Studio runs: read once, and
      // again only if that first read failed.
      if (!envLoaded.current) {
        setEnv(await api<Inventory>("/api/env"));
        envLoaded.current = true;
      }
    } catch (e) {
      // The last status is kept, but no longer shown as current (see below).
      setConnection(connectionAfterFailure(e));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), 5000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  // Whether a cross-chain message can be sent is not in the devnet status (it
  // only knows the L1s): it takes a look at the messengers, which the server
  // does for /api/icm/state. Asked only while a view shows it, and only when
  // there are two L1s to send between.
  const peers = countPeers(status?.l1s ?? []);
  const showsInterchain = view === "overview" || view === "devnet";
  useEffect(() => {
    if (peers < 2) setIcm(null);
  }, [peers]);
  useEffect(() => {
    if (!showsInterchain || peers < 2) return;
    let active = true;
    const tick = async () => {
      try {
        const state = await api<IcmState>("/api/icm/state");
        if (active) setIcm(state);
      } catch {
        /* keep last */
      }
    };
    void tick();
    const timer = setInterval(tick, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [showsInterchain, peers]);

  // An action ending is announced wherever the user happens to be.
  useEffect(
    () =>
      onFinished((finished) => {
        void refreshStatus();
        toast(finishNotice(finished));
      }),
    [onFinished, refreshStatus, toast],
  );

  useEffect(() => {
    if (!lost) return;
    toast({
      title: "Lost the connection to Studio",
      description:
        "The action in flight may still be running. Is Studio still running in your terminal?",
      variant: "error",
    });
  }, [lost, toast]);

  const hasCli = env?.tools.some((t) => t.name === "avalanche-cli" && t.installed) ?? false;
  // Stopped, or restarted with another session token: nothing on screen is current.
  const disconnected = connection === "offline" || connection === "stale-token";
  const meta = TITLES[view];

  return (
    <div className="min-h-dvh">
      {/* One-shot terminal boot splash — overlays the dashboard, which mounts
          underneath and is revealed when the splash fades. */}
      <BootSplash />
      <Sidebar
        active={view}
        onNavigate={setView}
        // What a Studio that no longer answers last said is not the network's state.
        network={disconnected ? null : (status?.running ?? null)}
      />

      <main className="ml-60 min-h-dvh">
        <header className="bg-background/80 sticky top-0 z-10 flex items-center justify-between border-b px-8 py-4 backdrop-blur">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              {meta.title}
              {isExperimental(view) && <Badge>experimental</Badge>}
            </h1>
            <p className="text-muted-foreground text-xs">{meta.sub}</p>
          </div>
          <div className="flex items-center gap-2">
            {busy && run && (
              <button
                type="button"
                onClick={() => setView(runHome(run))}
                title="Show the running action"
                className="hover:bg-accent flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs transition-colors"
              >
                <Dot state="live" />
                {runLabel(run)}
              </button>
            )}
            <span className="text-muted-foreground flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs">
              <span
                className={`size-1.5 rounded-full ${connection === "online" ? "bg-foreground" : "bg-muted-foreground/40"}`}
              />
              {connectionLabel(connection)}
            </span>
            <Button variant="outline" size="icon" aria-label="Toggle theme" onClick={toggle}>
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </header>

        <div className="px-8 py-8">
          {!disconnected && isExperimental(view) && <ExperimentalNote />}
          {disconnected ? (
            connection === "stale-token" ? (
              <div className="flex flex-col items-start gap-3">
                <p className="text-muted-foreground text-sm">
                  Studio didn't recognize this tab's session token — the server was likely restarted
                  since this page was opened. Reload to pick up the new token, or reopen the URL
                  printed in your terminal.
                </p>
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                  Reload
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Could not reach the Studio server. Is it still running in your terminal?
              </p>
            )
          ) : view === "overview" ? (
            <OverviewView env={env} status={status} icm={icm} navigate={setView} />
          ) : view === "devnet" ? (
            <DevnetView status={status} icm={icm} hasCli={hasCli} navigate={setView} />
          ) : view === "fuji" ? (
            <FujiView hasCli={hasCli} wizard={wizard} navigate={setView} />
          ) : view === "interchain" ? (
            <InterchainView />
          ) : view === "data" ? (
            <DataPanel />
          ) : (
            <EnvironmentView env={env} />
          )}
        </div>
      </main>
    </div>
  );
}
