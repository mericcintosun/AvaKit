"use client";

import { Check, Copy, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CopyAnnouncement, useCopy } from "@/components/use-copy";
import { cn } from "@/lib/utils";

export function CodeBlock({
  code,
  prefix,
  className,
}: {
  code: string;
  prefix?: string;
  className?: string;
}) {
  const { status, copy } = useCopy();

  return (
    <div className={cn("group bg-muted/40 relative min-w-0 rounded-lg border", className)}>
      <pre className="overflow-x-auto p-4 pr-12 font-mono text-sm leading-relaxed">
        <code>
          {prefix ? <span className="text-primary select-none">{prefix} </span> : null}
          {code}
        </code>
      </pre>
      <Button
        // Outline, not ghost: its solid fill masks a long line that scrolls
        // underneath instead of letting the icon sit on top of the text.
        variant="outline"
        size="icon"
        onClick={() => copy(code)}
        aria-label="Copy code"
        // Hidden until hover only where hovering exists; a touch screen has no
        // hover to reveal it with, so there it is always shown.
        className="absolute top-2 right-2 transition-opacity can-hover:opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      >
        {status === "copied" ? (
          <Check className="size-4" />
        ) : status === "failed" ? (
          <X className="text-destructive size-4" />
        ) : (
          <Copy className="size-4" />
        )}
      </Button>
      <CopyAnnouncement status={status} />
    </div>
  );
}
