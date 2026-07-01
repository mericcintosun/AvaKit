import { ArrowLeftRight, Boxes, FolderGit2, Package, Radio, Terminal } from "lucide-react";
import type { DevnetStatus, Inventory } from "../api";
import type { View } from "../components/Sidebar";
import { StatCard } from "../components/StatCard";

export function OverviewView({
  env,
  status,
  navigate,
}: {
  env: Inventory | null;
  status: DevnetStatus | null;
  navigate: (v: View) => void;
}) {
  const tool = (name: string) => env?.tools.find((t) => t.name === name);
  const cli = tool("avalanche-cli");
  const forge = tool("Foundry (forge)");
  const l1s = status?.l1s ?? [];
  const running = status?.running ?? false;
  const runningCount = l1s.filter((l) => l.running).length;
  const icmReady = runningCount >= 2;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        label="avalanche-cli"
        icon={Terminal}
        value={cli?.installed ? "Online" : "Missing"}
        badge={cli?.installed ? { text: "live", live: true } : undefined}
        sub={cli?.version ?? "not installed — see Environment"}
        onOpen={() => navigate("environment")}
      />
      <StatCard
        label="Foundry"
        icon={Package}
        value={forge?.installed ? "Ready" : "Missing"}
        sub={forge?.version ?? "cast/forge not installed"}
        onOpen={() => navigate("environment")}
      />
      <StatCard
        label="Network"
        icon={Radio}
        value={running ? "Up" : "Down"}
        badge={running ? { text: "live", live: true } : undefined}
        sub={running ? `${runningCount} L1s running` : "start it in Devnet"}
        onOpen={() => navigate("devnet")}
      />
      <StatCard
        label="Local L1s"
        icon={Boxes}
        value={l1s.length}
        sub={l1s.length ? l1s.map((l) => l.name).join(", ") : "none yet"}
        onOpen={() => navigate("devnet")}
      />
      <StatCard
        label="Interchain"
        icon={ArrowLeftRight}
        value={icmReady ? "Ready" : "—"}
        badge={icmReady ? { text: "live", live: true } : undefined}
        sub={icmReady ? "send a cross-chain message" : "needs 2 running L1s"}
        onOpen={() => navigate("interchain")}
      />
      <StatCard
        label="Project"
        icon={FolderGit2}
        value={env?.project.isAvaKit ? "AvaKit" : "—"}
        sub={env?.project.name ?? "not an AvaKit project here"}
        onOpen={() => navigate("environment")}
      />
    </div>
  );
}
