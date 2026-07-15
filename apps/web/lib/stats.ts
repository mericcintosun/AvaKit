/**
 * Public usage numbers for /stats, read from three independent sources.
 *
 * Every source degrades on its own: a source that fails returns null and the
 * page renders the rest with an honest "unavailable" instead of a fabricated
 * zero. A zero and "we couldn't reach npm" are very different claims, and this
 * page's whole value is that people believe the numbers on it.
 *
 * All of this runs server-side. GitHub's unauthenticated limit is 60 req/hour
 * per IP, which is per-visitor if you fetch from the browser but per-server if
 * you fetch here — with the revalidate windows below we make ~30 calls an hour
 * no matter how much traffic the page gets.
 */

/** The five published packages, in the order they're shown. */
export const NPM_PACKAGES = [
  "create-avalanche-app",
  "@avakit/core",
  "@avakit/react",
  "@avakit/mcp",
  "@avakit/studio",
] as const;

export const GITHUB_REPO = "mericcintosun/AvaKit";

/** Mirrors the collector's 5-minute edge cache (services/telemetry). */
const TELEMETRY_REVALIDATE = 300;
/** npm's download counts only move once a day; GitHub stars aren't urgent. */
const SLOW_REVALIDATE = 3600;

export interface NpmStats {
  /** Downloads in the last 30 days, summed across all packages. */
  last30d: number;
  /** Per-package last-30-day downloads, same order as NPM_PACKAGES. */
  byPackage: { name: string; downloads: number }[];
}

export interface GithubStats {
  stars: number;
  forks: number;
}

export interface TelemetryStats {
  scaffolds: {
    total: number;
    succeeded: number;
    last30d: number;
    byTemplate: Record<string, number>;
    byDay: { day: string; n: number }[];
  };
  installs: number;
  firstDay: string | null;
  updatedAt: string;
}

export interface Stats {
  npm: NpmStats | null;
  github: GithubStats | null;
  telemetry: TelemetryStats | null;
}

async function getJson<T>(url: string, revalidate: number): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      next: { revalidate },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function getNpm(): Promise<NpmStats | null> {
  // No bulk call here: npm's bulk downloads endpoint doesn't accept scoped
  // packages, and four of ours are scoped. Five requests, cached for an hour.
  const results = await Promise.all(
    NPM_PACKAGES.map(async (name): Promise<{ name: string; downloads: number } | null> => {
      const data = await getJson<{ downloads: number }>(
        `https://api.npmjs.org/downloads/point/last-month/${name}`,
        SLOW_REVALIDATE,
      );
      return data ? { name, downloads: data.downloads } : null;
    }),
  );
  const byPackage = results.filter((r) => r !== null);
  if (byPackage.length === 0) return null;
  return {
    last30d: byPackage.reduce((sum, p) => sum + p.downloads, 0),
    byPackage,
  };
}

async function getGithub(): Promise<GithubStats | null> {
  const data = await getJson<{ stargazers_count: number; forks_count: number }>(
    `https://api.github.com/repos/${GITHUB_REPO}`,
    SLOW_REVALIDATE,
  );
  if (!data) return null;
  return { stars: data.stargazers_count, forks: data.forks_count };
}

async function getTelemetry(): Promise<TelemetryStats | null> {
  // Server-only and unprefixed on purpose: there's no reason to hand every
  // visitor's browser the collector's URL. Unset (e.g. a preview deploy) reads
  // the same as unreachable — the page says so rather than showing zeros.
  const url = process.env.AVAKIT_TELEMETRY_STATS_URL;
  if (!url) return null;
  return getJson<TelemetryStats>(url, TELEMETRY_REVALIDATE);
}

export async function getStats(): Promise<Stats> {
  const [npm, github, telemetry] = await Promise.all([getNpm(), getGithub(), getTelemetry()]);
  return { npm, github, telemetry };
}

/**
 * Fill in the days the collector left out. It only returns days that saw a
 * scaffold, so plotting its rows directly would silently compress a quiet week
 * into nothing and misstate the shape of the series.
 */
export function zeroFillDays(byDay: { day: string; n: number }[], days: number, today: Date) {
  const counts = new Map(byDay.map((d) => [d.day, d.n]));
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - (days - 1 - i));
    const day = date.toISOString().slice(0, 10);
    return { day, n: counts.get(day) ?? 0 };
  });
}

/** 1284 → "1,284"; 12900 → "12.9K". Keeps a stat tile from wrapping. */
export function compact(n: number): string {
  if (n < 10_000) return n.toLocaleString("en-US");
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
