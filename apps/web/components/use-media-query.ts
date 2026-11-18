"use client";

import { useCallback, useSyncExternalStore } from "react";

const serverSnapshot = () => false;

/**
 * Track a CSS media query. It reads `false` on the server and while hydrating,
 * then the real value, so markup that depends on it never mismatches — and it
 * re-renders when the visitor changes the setting or resizes the window.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}

/** True from the `md` breakpoint up (>= 768px), where the heavy media is shown. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 768px)");
}

/** True when the visitor asked their OS or browser to reduce motion. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
