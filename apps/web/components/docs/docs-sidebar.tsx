"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const groups = [
  {
    title: "Getting started",
    items: [{ label: "Introduction", href: "/docs" }],
  },
  {
    title: "Packages",
    items: [
      { label: "@avakit/core", href: "/docs/core" },
      { label: "@avakit/react", href: "/docs/react" },
      { label: "create-avalanche-app", href: "/docs/cli" },
      { label: "@avakit/mcp", href: "/docs/mcp" },
      { label: "@avakit/studio", href: "/docs/studio" },
    ],
  },
];

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <span className="text-muted-foreground px-3 text-xs font-medium tracking-wide uppercase">
            {group.title}
          </span>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                pathname === item.href
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
