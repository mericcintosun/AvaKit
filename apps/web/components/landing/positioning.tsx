"use client";

import { motion } from "framer-motion";
import { Check, Minus } from "lucide-react";
import { useLocale } from "next-intl";

import { fadeUp, Reveal, RevealGroup } from "@/components/motion";
import { Container, Section, SectionHeading } from "@/components/section";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getContent, type Locale } from "@/lib/content";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n + 1).padStart(2, "0");

/* ── Differentiation: honest comparison ───────────────────────────────── */
export function DifferentiationSection() {
  const { differentiation: d } = getContent(useLocale() as Locale);
  return (
    <Section id="differentiation">
      <Container>
        <SectionHeading index="03" eyebrow={d.eyebrow} title={d.title} lead={d.lead} />
        <Reveal className="mt-10 overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="min-w-[220px]">
                    Capability
                  </TableHead>
                  {d.columns.map((col, i) => (
                    <TableHead
                      key={col}
                      scope="col"
                      className={cn(
                        "min-w-[110px] text-center",
                        i === 0 && "text-foreground font-semibold",
                      )}
                    >
                      {col}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.rows.map((row) => (
                  <TableRow key={row.label}>
                    {/* A row header, so a screen reader announces the capability
                        with each answer ("thirdweb, Open-source & free: Yes"). */}
                    <th
                      scope="row"
                      className="text-muted-foreground p-4 text-left align-middle font-normal"
                    >
                      {row.label}
                    </th>
                    {d.columns.map((col, i) => (
                      <TableCell
                        key={`${row.label}-${col}`}
                        className={cn("text-center", i === 0 && "bg-primary/5")}
                      >
                        {/* The icons are aria-hidden (lucide's default), so the
                            answer itself is spelled out for assistive tech. */}
                        {row.cells[i] ? (
                          <>
                            <Check className="text-primary mx-auto size-4" />
                            <span className="sr-only">Yes</span>
                          </>
                        ) : (
                          <>
                            <Minus className="text-muted-foreground/40 mx-auto size-4" />
                            <span className="sr-only">No</span>
                          </>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Reveal>
        <p className="text-muted-foreground mt-3 text-xs leading-relaxed">{d.note}</p>
      </Container>
    </Section>
  );
}

/* ── Who it's for + why now (PMF / GTM) ───────────────────────────────── */
export function WhoForSection() {
  const c = getContent(useLocale() as Locale);
  return (
    <Section id="who-for">
      <Container>
        <SectionHeading
          index="04"
          eyebrow={c.whoFor.eyebrow}
          title={c.whoFor.title}
          lead={c.whoFor.lead}
        />
        <RevealGroup className="mt-10 grid gap-3 sm:grid-cols-3">
          {c.audiences.map((a, i) => (
            <motion.div
              key={a.title}
              variants={fadeUp}
              className="flex flex-col gap-2 rounded-xl border p-6"
            >
              <span className="text-primary font-mono text-xs tabular-nums">{pad(i)}</span>
              <h3 className="font-medium">{a.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed text-pretty">{a.body}</p>
            </motion.div>
          ))}
        </RevealGroup>
      </Container>
    </Section>
  );
}
