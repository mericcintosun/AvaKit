"use client";

import { usePathname } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

const labels: Record<string, string> = {
  "/docs": "Introduction",
  "/docs/core": "@avakit/core",
  "/docs/react": "@avakit/react",
  "/docs/cli": "create-avalanche-app",
  "/docs/mcp": "@avakit/mcp",
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
