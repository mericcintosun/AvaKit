"use client";

import { ChartNoAxesColumn, FileText, House, LayoutTemplate } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { docsNav } from "@/components/docs/docs-nav";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

const groups = [
  {
    heading: "Navigate",
    items: [
      { label: "Home", href: "/", icon: House },
      { label: "Documentation", href: "/docs", icon: FileText },
      { label: "Templates", href: "/templates", icon: LayoutTemplate },
      { label: "Stats", href: "/stats", icon: ChartNoAxesColumn },
    ],
  },
  // Every docs page beyond the introduction (which "Documentation" above
  // already opens), straight from the list the docs sidebar renders.
  ...docsNav
    .map((group) => ({
      heading: group.title,
      items: group.items.filter((item) => item.href !== "/docs"),
    }))
    .filter((group) => group.items.length > 0),
];

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("avakit:command", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("avakit:command", onOpen);
    };
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search docs, packages, templates…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {groups.map((group, i) => (
          <div key={group.heading}>
            {i > 0 ? <CommandSeparator /> : null}
            <CommandGroup heading={group.heading}>
              {group.items.map((item) => (
                <CommandItem key={item.href} value={item.label} onSelect={() => go(item.href)}>
                  <item.icon />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

/** Dispatch this to open the command menu from anywhere. */
export function openCommandMenu() {
  window.dispatchEvent(new Event("avakit:command"));
}
