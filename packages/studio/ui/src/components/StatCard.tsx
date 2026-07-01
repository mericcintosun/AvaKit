import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export function StatCard({
  label,
  icon: Icon,
  value,
  badge,
  sub,
  onOpen,
}: {
  label: string;
  icon: LucideIcon;
  value: ReactNode;
  badge?: { text: string; live?: boolean };
  sub?: ReactNode;
  onOpen?: () => void;
}) {
  return (
    <div className="bg-card flex flex-col rounded-xl border p-5">
      <div className="text-muted-foreground flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide uppercase">{label}</span>
        <Icon className="size-4" />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        {badge && (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 font-mono text-[0.6rem] tracking-widest uppercase",
              badge.live ? "border-foreground/30" : "text-muted-foreground",
            )}
          >
            {badge.live && (
              <span className="bg-foreground mr-1 inline-block size-1.5 rounded-full align-middle" />
            )}
            {badge.text}
          </span>
        )}
      </div>
      {sub && <p className="text-muted-foreground mt-1 text-xs">{sub}</p>}
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="text-muted-foreground hover:text-foreground mt-4 flex items-center gap-1 text-xs transition-colors"
        >
          Open <span aria-hidden>→</span>
        </button>
      )}
    </div>
  );
}
