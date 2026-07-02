"use client";

import { useLocale } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

// Compact EN / TR toggle. Keeps the current path and only swaps the locale.
export function LanguageSwitcher() {
  const active = useLocale();
  const pathname = usePathname();

  return (
    <nav className="flex items-center rounded-md border p-0.5" aria-label="Language">
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          href={pathname}
          locale={locale}
          aria-current={locale === active ? "true" : undefined}
          className={cn(
            "rounded px-1.5 py-0.5 font-mono text-[11px] uppercase transition-colors",
            locale === active
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {locale}
        </Link>
      ))}
    </nav>
  );
}
