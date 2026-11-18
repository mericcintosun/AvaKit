import { ArrowLeftRight, Boxes, FolderGit2, Package, Radio, Terminal } from "lucide-react";
import type { DevnetStatus, IcmState, Inventory } from "../api";
import type { View } from "../components/Sidebar";
import { StatCard } from "../components/StatCard";
import { countPeers, interchainCard, interchainStage } from "../lib/interchain";

export function OverviewView({
  env,
  status,
  icm,
  navigate,
}: {
  env: Inventory | null;
  status: DevnetStatus | null;
  /** The server's Interchain state, or null while it is not known. */
  icm: IcmState | null;
  navigate: (v: View) => void;
}) {
  const tool = (name: string) => env?.tools.find((t) => t.name === name);
  const cli = tool("avalanche-cli");
  const forge = tool("Foundry (forge)");
  const l1s = status?.l1s ?? [];
  const running = status?.running ?? false;
  const runningCount = l1s.filter((l) => l.running).length;
  // "Ready" is the server's word (two linked messengers), never "two L1s are running".
  const interchain = interchainCard(interchainStage(countPeers(l1s), icm));

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
        value={interchain.value}
        badge={interchain.live ? { text: "live", live: true } : undefined}
        sub={interchain.sub}
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
