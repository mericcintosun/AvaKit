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
      <div className="mx-auto grid h-14 max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-5 sm:px-8">
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

          <LanguageSwitcher />
          <ThemeToggle />

          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/docs">{c.header.getStarted}</Link>
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
        </div>
      </div>
    </header>
  );
}
