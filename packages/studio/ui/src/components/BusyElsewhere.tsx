import { runHome, runLabel } from "../lib/run-messages";
import { useRunStatus } from "../run";
import type { View } from "./Sidebar";
import { Dot } from "./ui/badge";

/**
 * Explains why a view's action buttons are disabled when the action in flight
 * belongs to ANOTHER view: avalanche-cli actions run one at a time.
 */
export function BusyElsewhere({
  view,
  navigate,
}: {
  view: "devnet" | "fuji";
  navigate: (v: View) => void;
}) {
  const { run, busy } = useRunStatus();
  if (!busy || !run || runHome(run) === view) return null;
  return (
    <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
      <Dot state="live" />
      <span>
        “{runLabel(run)}” is running — avalanche-cli actions run one at a time, so this view waits
        for it.
      </span>
      <button
        type="button"
        onClick={() => navigate(runHome(run))}
        className="hover:text-foreground underline underline-offset-4"
      >
        Show it
      </button>
    </p>
  );
}
