import {
  ArrowLeftRight,
  Coins,
  LayoutDashboard,
  type LucideIcon,
  Rocket,
  Server,
  Triangle,
  Wrench,
} from "lucide-react";
import { EXPERIMENTAL_SECTION } from "../lib/experimental";
import { cn } from "../lib/utils";

export type View = "overview" | "devnet" | "fuji" | "interchain" | "data" | "environment";

type NavItem = { id: View; label: string; icon: LucideIcon };

// The views in their usual order, in three groups. The middle one holds every
// view that drives Avalanche CLI, which makes those views experimental.
const NAV: { title: string; items: NavItem[] }[] = [
  { title: "Main", items: [{ id: "overview", label: "Overview", icon: LayoutDashboard }] },
  {
    title: EXPERIMENTAL_SECTION,
    items: [
      { id: "devnet", label: "Devnet", icon: Server },
      { id: "fuji", label: "Launch on Fuji", icon: Rocket },
      { id: "interchain", label: "Interchain", icon: ArrowLeftRight },
    ],
  },
  {
    title: "Tools",
    items: [
      { id: "data", label: "Data", icon: Coins },
      { id: "environment", label: "Environment", icon: Wrench },
    ],
  },
];

export function Sidebar({
  active,
  onNavigate,
  network,
}: {
  active: View;
  onNavigate: (v: View) => void;
  network: boolean | null;
}) {
  return (
    <aside className="bg-card fixed inset-y-0 left-0 flex w-60 flex-col border-r p-3">
      <div className="flex items-center gap-2 px-2 py-3">
        <Triangle className="size-4 fill-current" />
        <span className="font-semibold tracking-tight">AvaKit Studio</span>
      </div>

      <button
        type="button"
        onClick={() => onNavigate("devnet")}
        className="bg-primary text-primary-foreground mt-1 mb-4 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-opacity hover:opacity-90"
      >
        <Server className="size-4" /> Spin up devnet
      </button>

      <nav className="flex flex-col gap-3">
        {NAV.map(({ title, items }) => (
          <div key={title} className="flex flex-col gap-0.5">
            <p className="text-muted-foreground px-2 pb-1 text-[0.65rem] font-semibold tracking-widest uppercase">
              {title}
            </p>
            {items.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onNavigate(id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                  active === id
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex items-center gap-2 px-2 py-2">
        <span
          className={cn(
            "size-2 rounded-full",
            network === null
              ? "bg-muted-foreground/40"
              : network
                ? "bg-foreground animate-pulse"
                : "bg-muted-foreground/40",
          )}
        />
        <span className="text-muted-foreground text-xs">
          {network === null ? "checking…" : network ? "devnet running" : "devnet down"}
        </span>
      </div>
    </aside>
  );
}
