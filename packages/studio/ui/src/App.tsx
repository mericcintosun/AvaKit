import { Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type DevnetStatus, type Inventory } from "./api";
import { Sidebar, type View } from "./components/Sidebar";
import { Button } from "./components/ui/button";
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
  const [env, setEnv] = useState<Inventory | null>(null);
  const [status, setStatus] = useState<DevnetStatus | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [staleToken, setStaleToken] = useState(false);
  const [view, setView] = useState<View>("overview");

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
      } catch (e) {
        setOnline(false);
        setStaleToken(e instanceof ApiError && e.status === 401);
      }
    })();
    const timer = setInterval(() => void refreshStatus(), 5000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  const hasCli = env?.tools.some((t) => t.name === "avalanche-cli" && t.installed) ?? false;
  const meta = TITLES[view];

  return (
    <div className="min-h-dvh">
      <Sidebar active={view} onNavigate={setView} network={status?.running ?? null} />

      <main className="ml-60 min-h-dvh">
        <header className="bg-background/80 sticky top-0 z-10 flex items-center justify-between border-b px-8 py-4 backdrop-blur">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{meta.title}</h1>
            <p className="text-muted-foreground text-xs">{meta.sub}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs">
              <span
                className={`size-1.5 rounded-full ${online ? "bg-foreground" : "bg-muted-foreground/40"}`}
              />
              {online === null ? "connecting" : online ? "connected" : "offline"}
            </span>
            <Button variant="outline" size="icon" aria-label="Toggle theme" onClick={toggle}>
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </header>

        <div className="px-8 py-8">
          {online === false ? (
            staleToken ? (
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
            <OverviewView env={env} status={status} navigate={setView} />
          ) : view === "devnet" ? (
            <DevnetView
              status={status}
              refresh={refreshStatus}
              hasCli={hasCli}
              navigate={setView}
            />
          ) : view === "fuji" ? (
            <FujiView hasCli={hasCli} />
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
