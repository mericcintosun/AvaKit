import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/utils";

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={label ?? "Copy"}
      aria-label={label ?? "Copy"}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={cn(
        "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors",
        className,
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {label && <span className="text-xs">{copied ? "Copied" : label}</span>}
    </button>
  );
}
