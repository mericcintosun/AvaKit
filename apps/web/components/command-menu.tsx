"use client";

import {
  Bot,
  Boxes,
  FileText,
  House,
  LayoutDashboard,
  LayoutTemplate,
  Terminal,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
    ],
  },
  {
    heading: "Packages",
    items: [
      { label: "@avakit/core", href: "/docs/core", icon: Boxes },
      { label: "@avakit/react", href: "/docs/react", icon: Wallet },
      { label: "create-avalanche-app", href: "/docs/cli", icon: Terminal },
      { label: "@avakit/mcp", href: "/docs/mcp", icon: Bot },
      { label: "@avakit/studio", href: "/docs/studio", icon: LayoutDashboard },
    ],
  },
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
