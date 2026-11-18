import { OTHER_TEMPLATE } from "@/lib/stats";
import { cn } from "@/lib/utils";

/**
 * Successful scaffolds by template.
 *
 * A table with an inline bar rather than a chart: eight templates all carry
 * meaning, and past ~7 classes the honest form is a table. It also sidesteps the
 * palette problem — identity comes from the row label, so one accent hue is all
 * this needs, where a pie would have demanded eight distinguishable colors we
 * don't have and shouldn't invent.
 *
 * A row keyed `other` is the collector's bucket for template ids it does not
 * recognise. It is labelled "Other", in the text font rather than the code font
 * the template ids use, because it is not the name of a template.
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
        {data.map((d) => {
          const other = d.template === OTHER_TEMPLATE;
          return (
            <tr key={d.template}>
              <th
                scope="row"
                className={cn(
                  "text-foreground w-40 py-1.5 pr-3 text-left text-xs font-normal",
                  other ? "font-sans" : "font-mono",
                )}
              >
                {other ? "Other" : d.template}
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
          );
        })}
      </tbody>
    </table>
  );
}
