"use client";

import { useSyncExternalStore } from "react";

import { useMediaQuery } from "@/components/use-media-query";

/** The slice of the (Chromium-only) Network Information API this hook reads. */
type NetworkInformation = EventTarget & {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
};

function getConnection(): NetworkInformation | undefined {
  return (navigator as Navigator & { connection?: NetworkInformation }).connection;
}

function subscribe(onChange: () => void) {
  const connection = getConnection();
  connection?.addEventListener("change", onChange);
  return () => connection?.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  const connection = getConnection();
  if (!connection) return false;
  // "4g" is the API's top bucket. Anything below it means the browser has
  // measured a slow link (about 0.7 Mbps down or 270 ms round trips, or worse),
  // where a multi-megabyte clip takes minutes.
  const slow = connection.effectiveType !== undefined && connection.effectiveType !== "4g";
  return connection.saveData === true || slow;
}

const serverSnapshot = () => false;

/**
 * True when multi-megabyte media should not be fetched unasked: the visitor
 * turned on Save-Data (or `prefers-reduced-data`), or the browser rates the
 * connection slower than "4g". Browsers that expose neither signal report
 * `false`. Like `useMediaQuery`, it reads `false` until hydration has finished.
 */
export function useDataSaver(): boolean {
  const reducedData = useMediaQuery("(prefers-reduced-data: reduce)");
  const constrained = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  return reducedData || constrained;
}
