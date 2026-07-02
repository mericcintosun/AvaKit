"use client";

import { Menu, Search } from "lucide-react";
import Image from "next/image";
import { useLocale } from "next-intl";

import { openCommandMenu } from "@/components/command-menu";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Link } from "@/i18n/navigation";
import { getContent, type Locale, site } from "@/lib/content";

export function SiteHeader() {
  const c = getContent(useLocale() as Locale);
  return (
    <header className="sticky top-0 z-40 border-b backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <Link href="/" className="flex items-center gap-2 justify-self-start">
          <Image
            src="/logo.png"
            alt="AvaKit logo"
            width={582}
            height={653}
            priority
            className="h-[22px] w-auto dark:invert"
          />
          <span className="font-mono text-sm font-semibold tracking-tight">{site.name}</span>
        </Link>

        <nav className="hidden items-center justify-center gap-5 md:flex">
          {c.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:text-foreground text-sm whitespace-nowrap transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-2">
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label="AvaKit on GitHub"
            className="hidden sm:inline-flex"
          >
            <a href={site.github} target="_blank" rel="noreferrer">
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
                <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-1.8c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 4.8 18 5.1 18 5.1c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.3.8 1 .8 2.1v3.1c0 .3.2.6.8.5 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5Z" />
              </svg>
              <span className="sr-only">GitHub</span>
            </a>
          </Button>
          <LanguageSwitcher />
          <ThemeToggle />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={c.header.search}
            className="sm:hidden"
            onClick={openCommandMenu}
          >
            <Search className="size-4" />
          </Button>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Menu" className="md:hidden">
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetTitle>{site.name}</SheetTitle>
              <nav className="mt-2 flex flex-col gap-1">
                {c.nav.map((item) => (
                  <SheetClose asChild key={item.href}>
                    <Link href={item.href} className="hover:bg-accent rounded-md px-3 py-2 text-sm">
                      {item.label}
                    </Link>
                  </SheetClose>
                ))}
                <SheetClose asChild>
                  <Link
                    href="/docs"
                    className="hover:bg-accent rounded-md px-3 py-2 text-sm font-medium"
                  >
                    {c.header.getStarted} →
                  </Link>
                </SheetClose>
              </nav>
            </SheetContent>
          </Sheet>

          <button
            type="button"
            onClick={openCommandMenu}
            className="text-muted-foreground hover:bg-accent hidden h-9 items-center gap-2 rounded-md border pr-2 pl-3 text-sm transition-colors sm:flex"
          >
            <Search className="size-3.5" />
            <span>{c.header.search}</span>
            <kbd className="bg-muted ml-2 hidden rounded border px-1.5 py-0.5 font-mono text-[10px] lg:inline-block">
              ⌘K
            </kbd>
          </button>
        </div>
      </div>
    </header>
  );
}
