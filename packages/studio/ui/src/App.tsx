import { Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type DevnetStatus, type Inventory } from "./api";
import { Sidebar, type View } from "./components/Sidebar";
import { Button } from "./components/ui/button";
import { DevnetView } from "./views/DevnetView";
import { EnvironmentView } from "./views/EnvironmentView";
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
  interchain: {
    title: "Interchain Messaging",
    sub: "Deploy messengers and watch a message travel between two L1s.",
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
      } catch {
        setOnline(false);
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
            <p className="text-muted-foreground text-sm">
              Could not reach the Studio server. Is it still running in your terminal?
            </p>
          ) : view === "overview" ? (
            <OverviewView env={env} status={status} navigate={setView} />
          ) : view === "devnet" ? (
            <DevnetView status={status} refresh={refreshStatus} hasCli={hasCli} />
          ) : view === "interchain" ? (
            <InterchainView />
          ) : (
            <EnvironmentView env={env} />
          )}
        </div>
      </main>
    </div>
  );
}
