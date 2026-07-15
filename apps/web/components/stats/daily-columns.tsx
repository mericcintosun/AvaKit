/**
 * Scaffolds per day, last 30 days. One series, so no legend — the heading says
 * what's plotted.
 *
 * Columns rather than a line: these are discrete daily counts with real gaps in
 * them, and a line would draw a confident slope across a day nothing happened.
 * The series is zero-filled upstream for the same reason.
 */

const WIDTH = 720;
const HEIGHT = 168;
const BASELINE = HEIGHT - 22; // room for the date labels
const TOP = 22; // room for the peak's value label
const RADIUS = 4;

/** A column with a rounded cap and a square foot, per the mark spec. */
function columnPath(x: number, y: number, width: number, height: number): string {
  if (height <= 0) return "";
  const r = Math.min(RADIUS, height, width / 2);
  return [
    `M ${x} ${y + height}`,
    `L ${x} ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `A ${r} ${r} 0 0 1 ${x + width} ${y + r}`,
    `L ${x + width} ${y + height}`,
    "Z",
  ].join(" ");
}

function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function DailyColumns({ data }: { data: { day: string; n: number }[] }) {
  const max = Math.max(...data.map((d) => d.n), 1);
  const band = WIDTH / data.length;
  // The 2px surface gap is what separates neighbours — never a stroke — and the
  // 24px cap keeps a column from filling its whole band.
  const barWidth = Math.min(band - 2, 24);
  const peak = data.reduce((best, d) => (d.n > best.n ? d : best), data[0]);
  const scale = (n: number) => (n / max) * (BASELINE - TOP);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Scaffolds per day for the last ${data.length} days. Peak ${peak.n} on ${shortDate(peak.day)}.`}
    >
      <title>{`Scaffolds per day, last ${data.length} days`}</title>

      <line
        x1={0}
        y1={BASELINE}
        x2={WIDTH}
        y2={BASELINE}
        className="stroke-border"
        strokeWidth={1}
      />

      {data.map((d, i) => {
        const height = scale(d.n);
        const x = i * band + (band - barWidth) / 2;
        return (
          <g key={d.day}>
            {/* A full-height hit area, so a 1px column is still hoverable. */}
            <rect x={i * band} y={TOP} width={band} height={BASELINE - TOP} fill="transparent">
              <title>{`${shortDate(d.day)} — ${d.n} scaffold${d.n === 1 ? "" : "s"}`}</title>
            </rect>
            {d.n > 0 ? (
              <path
                d={columnPath(x, BASELINE - height, barWidth, height)}
                className="fill-primary"
                pointerEvents="none"
              />
            ) : null}
          </g>
        );
      })}

      {/* Label the peak only. A number on all 30 columns goes unread. */}
      {peak.n > 0 ? (
        <text
          x={data.indexOf(peak) * band + band / 2}
          y={BASELINE - scale(peak.n) - 8}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
        >
          {peak.n}
        </text>
      ) : null}

      <text x={0} y={HEIGHT - 6} className="fill-muted-foreground text-[11px]">
        {shortDate(data[0].day)}
      </text>
      <text x={WIDTH} y={HEIGHT - 6} textAnchor="end" className="fill-muted-foreground text-[11px]">
        {shortDate(data[data.length - 1].day)}
      </text>
    </svg>
  );
}
