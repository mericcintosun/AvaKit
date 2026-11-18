"use client";

import { docsNav } from "@/components/docs/docs-nav";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export function DocsSidebar({
  onNavigate,
}: {
  /** Called when a link is followed, e.g. to close the sheet that holds the nav. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className="flex flex-col gap-6">
      {docsNav.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <span className="text-muted-foreground px-3 text-xs font-medium tracking-wide uppercase">
            {group.title}
          </span>
          {group.items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
