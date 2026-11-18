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
  /** Per-package last-30-day downloads: every package, same order as NPM_PACKAGES. */
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

/**
 * How long one source may take. A source that accepts the connection and then
 * stalls has to count as down: /stats is prerendered, so an unbounded wait here
 * would hold `next build` until the static-generation timeout fails the deploy.
 */
const FETCH_TIMEOUT_MS = 5000;

/** The parsed body, or null for anything that isn't a timely 2xx JSON response. */
async function getJson(url: string, revalidate: number): Promise<unknown> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      next: { revalidate },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// A 200 is not proof of the right payload: a mistyped URL can answer with some
// other JSON, and the page would then print `undefined` as a number or throw on
// it. So every source is checked field by field before it counts as an answer.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A count: a finite, non-negative number. */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

async function getNpm(): Promise<NpmStats | null> {
  // No bulk call here: npm's bulk downloads endpoint doesn't accept scoped
  // packages, and four of ours are scoped. Five requests, cached for an hour.
  const results = await Promise.all(
    NPM_PACKAGES.map(async (name): Promise<{ name: string; downloads: number } | null> => {
      const data = await getJson(
        `https://api.npmjs.org/downloads/point/last-month/${name}`,
        SLOW_REVALIDATE,
      );
      return isRecord(data) && isCount(data.downloads) ? { name, downloads: data.downloads } : null;
    }),
  );
  // All or nothing: the total is published as the figure for every package, so
  // a sum that is missing some of them is not a smaller answer but a wrong one.
  // The requests that failed are retried on the next revalidation.
  const byPackage = results.filter((r) => r !== null);
  if (byPackage.length !== NPM_PACKAGES.length) return null;
  return {
    last30d: byPackage.reduce((sum, p) => sum + p.downloads, 0),
    byPackage,
  };
}

async function getGithub(): Promise<GithubStats | null> {
  const data = await getJson(`https://api.github.com/repos/${GITHUB_REPO}`, SLOW_REVALIDATE);
  if (!isRecord(data) || !isCount(data.stargazers_count) || !isCount(data.forks_count)) {
    return null;
  }
  return { stars: data.stargazers_count, forks: data.forks_count };
}

/** The collector's /stats body, or null if it is anything else. */
function parseTelemetry(data: unknown): TelemetryStats | null {
  if (!isRecord(data) || !isRecord(data.scaffolds)) return null;
  const { total, succeeded, last30d, byTemplate, byDay } = data.scaffolds;
  const { installs, firstDay, updatedAt } = data;
  if (!isCount(total) || !isCount(succeeded) || !isCount(last30d) || !isCount(installs)) {
    return null;
  }
  if (!isRecord(byTemplate) || !Object.values(byTemplate).every(isCount)) return null;
  if (
    !Array.isArray(byDay) ||
    !byDay.every((d) => isRecord(d) && typeof d.day === "string" && isCount(d.n))
  ) {
    return null;
  }
  if (firstDay !== null && typeof firstDay !== "string") return null;
  if (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))) return null;
  return {
    scaffolds: {
      total,
      succeeded,
      last30d,
      byTemplate: byTemplate as Record<string, number>,
      byDay: byDay as { day: string; n: number }[],
    },
    installs,
    firstDay,
    updatedAt,
  };
}

async function getTelemetry(): Promise<TelemetryStats | null> {
  // Server-only and unprefixed on purpose: there's no reason to hand every
  // visitor's browser the collector's URL. Unset (e.g. a preview deploy) reads
  // the same as unreachable — the page says so rather than showing zeros.
  const url = process.env.AVAKIT_TELEMETRY_STATS_URL;
  if (!url) return null;
  return parseTelemetry(await getJson(url, TELEMETRY_REVALIDATE));
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
