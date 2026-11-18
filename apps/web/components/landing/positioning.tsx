"use client";

import { motion } from "framer-motion";
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

/* ── AvaKit next to the official Avalanche tools ──────────────────────────
   Sentences, not checkmarks: a tick or a dash cannot say "hosted, behind a
   sign-in" or "read-only", and those differences are the whole point of the
   section. The copy lives in lib/content.ts, with the date it was checked. */
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
                  {/* Narrower on a phone, so the edge of the last column shows
                      and the table reads as something to scroll sideways. */}
                  <TableHead scope="col" className="min-w-[110px] sm:min-w-[160px]">
                    {d.topic}
                  </TableHead>
                  {d.columns.map((col, i) => (
                    <TableHead
                      key={col}
                      scope="col"
                      className={cn(
                        "min-w-[200px] sm:min-w-[240px]",
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
                    {/* A row header, so a screen reader announces the topic with
                        each answer ("AvaKit, Mainnet: A separate, guarded step…"). */}
                    <th
                      scope="row"
                      className="text-foreground p-4 text-left align-top text-sm font-medium"
                    >
                      {row.label}
                    </th>
                    {d.columns.map((col, i) => (
                      <TableCell
                        key={`${row.label}-${col}`}
                        className={cn(
                          "text-muted-foreground align-top text-sm leading-relaxed text-pretty",
                          i === 0 && "bg-primary/5",
                        )}
                      >
                        {row.cells[i]}
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
