import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-5xl px-5 sm:px-8", className)}>{children}</div>;
}

export function Section({
  id,
  className,
  bordered = true,
  children,
}: {
  id?: string;
  className?: string;
  bordered?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cn("py-20 sm:py-28", bordered && "border-t", className)}>
      {children}
    </section>
  );
}

export function Eyebrow({ index, children }: { index?: string; children: ReactNode }) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-2.5 font-mono text-xs tracking-[0.2em] uppercase">
      {index ? <span className="text-foreground/40 tabular-nums">{index}</span> : null}
      <span className="bg-border inline-block h-px w-6" />
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  index,
  title,
  lead,
  align = "left",
  className,
}: {
  eyebrow: string;
  index?: string;
  title: string;
  lead?: string;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-5",
        align === "center" && "items-center text-center",
        className,
      )}
    >
      <Eyebrow index={index}>{eyebrow}</Eyebrow>
      <h2 className="max-w-4xl text-4xl font-semibold text-balance uppercase sm:text-5xl lg:text-[4.25rem] lg:leading-[0.92] [word-spacing:-0.05em] tracking-[-0.03em]">
        {title}
      </h2>
      {lead ? (
        <p className="text-muted-foreground max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
          {lead}
        </p>
      ) : null}
    </div>
  );
}
