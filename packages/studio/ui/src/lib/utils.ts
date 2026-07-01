import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function shortHex(s: string | null | undefined, n = 6): string {
  if (!s) return "—";
  return s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-4)}` : s;
}
