"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
// The locale-aware pathname, not next/navigation's: that one keeps the `/tr`
// prefix, so every lookup below missed and the Turkish docs showed a bare
// "Docs" crumb.
import { usePathname } from "@/i18n/navigation";

const labels: Record<string, string> = {
  "/docs": "Introduction",
  "/docs/core": "@avakit/core",
  "/docs/react": "@avakit/react",
  "/docs/cli": "create-avalanche-app",
  "/docs/mcp": "@avakit/mcp",
  "/docs/studio": "@avakit/studio",
  "/docs/telemetry": "Telemetry",
};

export function DocsBreadcrumb() {
  const pathname = usePathname();
  const current = labels[pathname];
  const atRoot = pathname === "/docs";

  return (
    <Breadcrumb className="mb-2">
      <BreadcrumbList className="font-mono text-xs">
        <BreadcrumbItem>
          <BreadcrumbLink href="/docs">Docs</BreadcrumbLink>
        </BreadcrumbItem>
        {!atRoot && current ? (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{current}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : null}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
