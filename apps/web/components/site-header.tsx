"use client";

import { Menu, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { openCommandMenu } from "@/components/command-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { nav, site } from "@/lib/content";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex items-center gap-7">
          <Link href="/" className="flex items-center gap-2">
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
          <nav className="hidden items-center gap-5 md:flex">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-muted-foreground hover:text-foreground text-sm transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openCommandMenu}
            className="text-muted-foreground hover:bg-accent hidden h-9 items-center gap-2 rounded-md border pr-2 pl-3 text-sm transition-colors sm:flex"
          >
            <Search className="size-3.5" />
            <span>Search</span>
            <kbd className="bg-muted ml-2 hidden rounded border px-1.5 py-0.5 font-mono text-[10px] lg:inline-block">
              ⌘K
            </kbd>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Search"
            className="sm:hidden"
            onClick={openCommandMenu}
          >
            <Search className="size-4" />
          </Button>

          <ThemeToggle />

          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/docs">Get started</Link>
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
                {nav.map((item) => (
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
                    Get started →
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
