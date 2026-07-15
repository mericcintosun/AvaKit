/**
 * Successful scaffolds by template.
 *
 * A table with an inline bar rather than a chart: eight templates all carry
 * meaning, and past ~7 classes the honest form is a table. It also sidesteps the
 * palette problem — identity comes from the row label, so one accent hue is all
 * this needs, where a pie would have demanded eight distinguishable colors we
 * don't have and shouldn't invent.
 */

export function TemplateBars({ data }: { data: { template: string; n: number }[] }) {
  const max = Math.max(...data.map((d) => d.n), 1);

  return (
    <table className="w-full border-collapse">
      <caption className="sr-only">Successful scaffolds by template</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Template</th>
          <th scope="col">Scaffolds</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.template}>
            <th
              scope="row"
              className="text-foreground w-40 py-1.5 pr-3 text-left font-mono text-xs font-normal"
            >
              {d.template}
            </th>
            <td className="py-1.5">
              <div className="flex items-center gap-2">
                {/* Rounded cap, square foot — the same mark spec as the columns. */}
                <div
                  className="bg-primary h-2.5 rounded-r-[3px]"
                  style={{ width: `${Math.max((d.n / max) * 100, 1.5)}%` }}
                />
                <span className="text-muted-foreground text-xs tabular-nums">{d.n}</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
