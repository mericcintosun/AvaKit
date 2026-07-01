import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function shortHex(s: string | null | undefined, n = 6): string {
  if (!s) return "—";
  return s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-4)}` : s;
}

/** Format a wei-string balance as a human amount (BigInt-safe, no viem). */
export function formatUnits(value: string, decimals: number, dp = 4): string {
  try {
    const v = BigInt(value);
    const base = 10n ** BigInt(decimals);
    const whole = v / base;
    const frac = v % base;
    if (frac === 0n) return whole.toString();
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, dp).replace(/0+$/, "");
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
  } catch {
    return "0";
  }
}
