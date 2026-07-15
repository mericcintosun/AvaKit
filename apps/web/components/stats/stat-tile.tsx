import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

/**
 * One headline number. Proportional figures, not tabular — `tabular-nums` gives
 * every digit the width of a zero, which reads loose at this size. Tabular is
 * for columns that must align.
 */
export function StatTile({
  label,
  value,
  hint,
  source,
}: {
  label: string;
  value: string | null;
  hint?: ReactNode;
  /** Where the number came from — this page lives or dies on being checkable. */
  source?: string;
}) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <span className="text-muted-foreground text-sm">{label}</span>
      {value === null ? (
        <span className="text-muted-foreground text-2xl font-medium">—</span>
      ) : (
        <span className="text-3xl font-semibold tracking-tight">{value}</span>
      )}
      {value === null ? (
        <span className="text-muted-foreground text-xs">
          Couldn't reach {source ?? "the source"}
        </span>
      ) : hint ? (
        <span className="text-muted-foreground text-xs">{hint}</span>
      ) : null}
    </Card>
  );
}
