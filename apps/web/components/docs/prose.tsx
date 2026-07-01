import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function DocHeader({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {lead ? <p className="text-muted-foreground text-lg text-balance">{lead}</p> : null}
    </div>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-6 scroll-mt-20 border-b pb-2 text-xl font-semibold tracking-tight">
      {children}
    </h2>
  );
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-muted-foreground leading-relaxed", className)}>{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="text-muted-foreground flex list-disc flex-col gap-2 pl-5 leading-relaxed">
      {children}
    </ul>
  );
}

export function C({ children }: { children: ReactNode }) {
  return <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-sm">{children}</code>;
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith("http");
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="text-foreground underline underline-offset-4"
    >
      {children}
    </Link>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="bg-muted/40 text-muted-foreground rounded-lg border px-4 py-3 text-sm leading-relaxed">
      {children}
    </div>
  );
}

export function NextLinks({
  items,
}: {
  items: { label: string; href: string; description: string }[];
}) {
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="hover:border-foreground/30 flex flex-col gap-1 rounded-lg border p-4 transition-colors"
        >
          <span className="font-medium">{item.label} →</span>
          <span className="text-muted-foreground text-sm">{item.description}</span>
        </Link>
      ))}
    </div>
  );
}
