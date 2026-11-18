import {
  Bot,
  Boxes,
  FileText,
  LayoutDashboard,
  type LucideIcon,
  Radio,
  Terminal,
  Wallet,
} from "lucide-react";

export type DocsNavItem = { label: string; href: string; icon: LucideIcon };

/**
 * Every docs page, in reading order. The sidebar, its mobile sheet, the
 * breadcrumb and the command menu all read this one list, so a new page cannot
 * be linked from one of them and forgotten in another.
 */
export const docsNav: { title: string; items: DocsNavItem[] }[] = [
  {
    title: "Getting started",
    items: [{ label: "Introduction", href: "/docs", icon: FileText }],
  },
  {
    title: "Packages",
    items: [
      { label: "@avakit/core", href: "/docs/core", icon: Boxes },
      { label: "@avakit/react", href: "/docs/react", icon: Wallet },
      { label: "create-avalanche-app", href: "/docs/cli", icon: Terminal },
      { label: "@avakit/mcp", href: "/docs/mcp", icon: Bot },
      { label: "@avakit/studio", href: "/docs/studio", icon: LayoutDashboard },
    ],
  },
  {
    title: "Project",
    items: [{ label: "Telemetry", href: "/docs/telemetry", icon: Radio }],
  },
];
