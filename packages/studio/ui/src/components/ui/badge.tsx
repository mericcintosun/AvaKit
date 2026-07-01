import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs",
        className,
      )}
      {...props}
    />
  );
}

export function Dot({ state }: { state: "on" | "live" | "off" }) {
  return (
    <span
      className={cn(
        "size-2 rounded-full",
        state === "off" && "bg-muted-foreground/40",
        state === "on" && "bg-foreground",
        state === "live" && "bg-foreground animate-pulse",
      )}
    />
  );
}
