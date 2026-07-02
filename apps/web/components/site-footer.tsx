import Image from "next/image";
import { getLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { getContent, type Locale, site } from "@/lib/content";

const columns = [
  {
    title: "Product",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "Templates", href: "/templates" },
      { label: "MCP server", href: "/docs/mcp" },
    ],
  },
  {
    title: "Packages",
    links: [
      { label: "@avakit/core", href: "/docs/core" },
      { label: "@avakit/react", href: "/docs/react" },
      { label: "create-avalanche-app", href: "/docs/cli" },
      { label: "@avakit/mcp", href: "/docs/mcp" },
      { label: "@avakit/studio", href: "/docs/studio" },
    ],
  },
  {
    title: "Ecosystem",
    links: [
      { label: "Avalanche Builder Hub", href: "https://build.avax.network" },
      { label: "Web3Auth", href: "https://dashboard.web3auth.io" },
      { label: "Fuji faucet", href: "https://core.app/tools/testnet-faucet" },
    ],
  },
];

export async function SiteFooter() {
  const locale = (await getLocale()) as Locale;
  const c = getContent(locale);
  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="AvaKit logo"
              width={582}
              height={653}
              className="h-5 w-auto dark:invert"
            />
            <span className="font-mono text-sm font-semibold">{site.name}</span>
          </div>
          <p className="text-muted-foreground max-w-xs text-sm leading-relaxed">
            {c.footer.tagline}
          </p>
        </div>
        {columns.map((col) => (
          <div key={col.title} className="flex flex-col gap-3">
            <span className="text-sm font-medium">{col.title}</span>
            <ul className="flex flex-col gap-2">
              {col.links.map((link) => {
                const external = link.href.startsWith("http");
                return (
                  <li key={link.href}>
                    {external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs sm:flex-row sm:px-6">
          <span>MIT © {site.name} contributors</span>
          <div className="flex items-center gap-4">
            <a
              href={site.github}
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground transition-colors"
            >
              GitHub
            </a>
            <a
              href={site.npm}
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground transition-colors"
            >
              npm
            </a>
            <span className="font-mono">Open-source · AI-native · Avalanche</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
