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

/**
 * The `md` breakpoint, from which the heavy media sections are shown. Written
 * in rem exactly as Tailwind compiles `md:` (768px at the default font size),
 * so this and the `hidden md:block` on those sections switch at the same width
 * whatever font size the visitor's browser is set to.
 */
export const DESKTOP_QUERY = "(min-width: 48rem)";

/** True from the `md` breakpoint up, where the heavy media is shown. */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}

/** True when the visitor asked their OS or browser to reduce motion. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
