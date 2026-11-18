import type { Metadata } from "next";
import Link from "next/link";

import { DailyColumns } from "@/components/stats/daily-columns";
import { StatTile } from "@/components/stats/stat-tile";
import { TemplateBars } from "@/components/stats/template-bars";
import { Card } from "@/components/ui/card";
import { pageMetadata } from "@/lib/metadata";
import {
  compact,
  GITHUB_REPO,
  getStats,
  NPM_PACKAGES,
  OTHER_TEMPLATE,
  zeroFillDays,
} from "@/lib/stats";

export const metadata: Metadata = pageMetadata({
  route: "/stats",
  title: "Stats",
  description:
    "How much AvaKit actually gets used: npm downloads, GitHub stars, and anonymous scaffold counts, refreshed through the day.",
});

// Matches the collector's own five-minute memo of the aggregate (it computes
// the numbers at most that often). Without this the page would be baked at
// build time and the numbers would be frozen until the next deploy.
export const revalidate = 300;

const DAYS = 30;

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">{title}</h2>
        <p className="text-muted-foreground text-sm">{subtitle}</p>
      </div>
      {children}
    </Card>
  );
}

export default async function StatsPage() {
  const { npm, github, telemetry } = await getStats();

  // Most-picked first, with the collector's "other" bucket (template ids it
  // does not recognise) always last: it is a remainder, not a contender.
  const byTemplate = Object.entries(telemetry?.scaffolds.byTemplate ?? {})
    .map(([template, n]) => ({ template, n }))
    .sort(
      (a, b) =>
        Number(a.template === OTHER_TEMPLATE) - Number(b.template === OTHER_TEMPLATE) || b.n - a.n,
    );
  const hasOther = byTemplate.some((row) => row.template === OTHER_TEMPLATE);

  const days = telemetry ? zeroFillDays(telemetry.scaffolds.byDay, DAYS, new Date()) : [];
  const hasScaffolds = (telemetry?.scaffolds.succeeded ?? 0) > 0;

  return (
    // English only, also under /tr, so the page says which language it is in.
    <div lang="en" className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-12 sm:px-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-primary text-3xl font-semibold tracking-tight">Stats</h1>
        <p className="text-muted-foreground text-lg text-balance">
          How much AvaKit actually gets used. The npm and GitHub numbers come from those services
          and can be checked there; the scaffold and install counts are the project's own.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="npm downloads"
          value={npm ? compact(npm.last30d) : null}
          hint={`Last 30 days, all ${NPM_PACKAGES.length} packages`}
          source="npm"
        />
        <StatTile
          label="GitHub stars"
          value={github ? compact(github.stars) : null}
          hint={github ? `${compact(github.forks)} forks` : undefined}
          source="GitHub"
        />
        <StatTile
          label="Apps scaffolded"
          value={telemetry ? compact(telemetry.scaffolds.succeeded) : null}
          hint={
            telemetry ? `${compact(telemetry.scaffolds.last30d)} in the last 30 days` : undefined
          }
          source="the collector"
        />
        <StatTile
          label="Unique installs"
          value={telemetry ? compact(telemetry.installs) : null}
          hint="Distinct anonymous ids, not runs"
          source="the collector"
        />
      </div>

      <p className="text-muted-foreground -mt-4 text-sm leading-relaxed">
        The scaffold and install counts leave out CI runs and anyone who opted out, and they are
        kept by the project itself, not by a third party:{" "}
        <Link href="/docs/telemetry" className="text-foreground underline underline-offset-4">
          how they are collected
        </Link>
        .
      </p>

      {telemetry && hasScaffolds ? (
        <Section
          title="Scaffolds per day"
          subtitle={`The last ${DAYS} days. Successful scaffolds only.`}
        >
          <DailyColumns data={days} />
        </Section>
      ) : null}

      {byTemplate.length > 0 ? (
        <Section
          title="Templates"
          subtitle={
            hasOther
              ? "Which starter people actually pick, since we started counting. Other is every scaffold whose template name the collector did not recognise."
              : "Which starter people actually pick, since we started counting."
          }
        >
          <TemplateBars data={byTemplate} />
        </Section>
      ) : null}

      {npm ? (
        <Section title="Downloads by package" subtitle="Last 30 days, from npm's public API.">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="pb-2 font-normal">
                  Package
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  Downloads
                </th>
              </tr>
            </thead>
            <tbody>
              {npm.byPackage.map((p) => (
                <tr key={p.name} className="border-b last:border-0">
                  <td className="py-2">
                    <Link
                      href={`https://www.npmjs.com/package/${p.name}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs underline-offset-4 hover:underline"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {p.downloads.toLocaleString("en-US")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {telemetry && !hasScaffolds ? (
        <Card className="text-muted-foreground p-5 text-sm">
          No scaffolds counted yet. The collector is up and reachable — this is a real zero, not a
          broken number.
        </Card>
      ) : null}

      {!telemetry ? (
        <Card className="text-muted-foreground p-5 text-sm">
          Scaffold counts are unavailable right now — the collector didn't answer. The npm and
          GitHub numbers above are unaffected.
        </Card>
      ) : null}

      <div className="text-muted-foreground flex flex-col gap-2 text-sm">
        <h2 className="text-foreground font-medium">How to read these</h2>
        <p className="leading-relaxed">
          npm downloads and GitHub stars come straight from{" "}
          <Link
            href="https://api.npmjs.org/downloads/point/last-month/create-avalanche-app"
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-4"
          >
            npm's public API
          </Link>{" "}
          and{" "}
          <Link
            href={`https://github.com/${GITHUB_REPO}`}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-4"
          >
            GitHub's
          </Link>
          — check them yourself. Downloads count robots and mirrors as well as people, so read them
          as a ceiling.
        </p>
        <p className="leading-relaxed">
          Scaffold and install counts are{" "}
          <Link href="/docs/telemetry" className="text-foreground underline underline-offset-4">
            self-reported by the CLI
          </Link>
          , which is off in CI and easy to opt out of — so they're a floor, and a determined person
          could inflate them. They also cannot tell the maintainer's own runs from anyone else's. We
          publish both kinds side by side precisely because neither is trustworthy alone: one is
          independent but blunt, the other is specific but spoofable.
        </p>
        {telemetry ? (
          <p className="text-xs">
            Counting since {telemetry.firstDay ?? "—"}. Collector last read{" "}
            {new Date(telemetry.updatedAt).toISOString().replace("T", " ").slice(0, 16)} UTC.
          </p>
        ) : null}
      </div>
    </div>
  );
}
