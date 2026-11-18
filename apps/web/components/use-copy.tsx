"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CopyStatus = "idle" | "copied" | "failed";

/**
 * Copy `text` to the clipboard, resolving to whether it worked instead of
 * throwing. The async Clipboard API does not exist outside a secure context (a
 * plain-http LAN preview, some in-app webviews) and rejects when permission is
 * denied, so either case falls back to the older selection-based copy before
 * the attempt is reported as failed.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied or unavailable: try the fallback below.
  }
  return copyViaSelection(text);
}

function copyViaSelection(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  // Off screen but still selectable; `display: none` would defeat the copy.
  field.style.position = "fixed";
  field.style.top = "0";
  field.style.left = "-9999px";
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(field);
  field.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  field.remove();
  focused?.focus();
  return ok;
}

/**
 * Copy with feedback. `status` turns "copied" or "failed" for `resetAfterMs`
 * and then returns to "idle", so a button can swap its icon either way.
 */
export function useCopy(resetAfterMs = 1500) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      setStatus(ok ? "copied" : "failed");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus("idle"), resetAfterMs);
      return ok;
    },
    [resetAfterMs],
  );

  return { status, copy };
}

/** Tells screen readers how a copy went; the icon swap alone is silent to them. */
export function CopyAnnouncement({ status }: { status: CopyStatus }) {
  return (
    <span role="status" className="sr-only">
      {status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : ""}
    </span>
  );
}
