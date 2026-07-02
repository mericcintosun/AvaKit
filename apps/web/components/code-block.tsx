"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className={cn("group bg-muted/40 relative min-w-0 rounded-lg border", className)}>
      <pre className="overflow-x-auto p-4 pr-12 font-mono text-sm leading-relaxed">
        <code>
          {prefix ? <span className="text-primary select-none">{prefix} </span> : null}
          {code}
        </code>
      </pre>
      <Button
        variant="ghost"
        size="icon"
        onClick={copy}
        aria-label="Copy code"
        className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}
