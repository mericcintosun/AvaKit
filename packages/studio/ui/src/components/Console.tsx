import { Eraser, Square, Terminal } from "lucide-react";
import { useEffect, useRef } from "react";
import { CopyButton } from "./copy-button";

/**
 * The live output of an avalanche-cli action. The log comes from the run store
 * (and so from the server), which is why it is still here after switching views
 * or reloading the page.
 */
export function Console({
  log,
  busy,
  note,
  onClear,
  onCancel,
}: {
  log: string[];
  busy: boolean;
  /** Shown under the output, e.g. when the live connection was lost. */
  note?: string;
  /** Forget this (finished) output. */
  onClear?: () => void;
  /** Stop the action in flight. */
  onCancel?: () => void;
}) {
  const termRef = useRef<HTMLPreElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run to auto-scroll as the log grows
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [log]);

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="bg-muted/40 flex items-center justify-between border-b px-3 py-2">
        <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
          <Terminal className="size-3.5" /> console
        </span>
        <div className="flex items-center gap-3">
          <CopyButton value={log.join("\n")} label="Copy" />
          {busy && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
            >
              <Square className="size-3" /> Cancel
            </button>
          )}
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              disabled={busy}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs disabled:opacity-40"
            >
              <Eraser className="size-3.5" /> Clear
            </button>
          )}
        </div>
      </div>
      <pre
        ref={termRef}
        className="max-h-96 overflow-auto bg-black p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-neutral-200"
      >
        {log.join("\n")}
      </pre>
      {note && <p className="text-muted-foreground border-t px-3 py-2 text-xs">{note}</p>}
    </div>
  );
}
