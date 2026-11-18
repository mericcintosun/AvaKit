import type { ReactNode } from "react";

import { DocsBreadcrumb } from "@/components/docs/docs-breadcrumb";
import { DocsMobileNav } from "@/components/docs/docs-mobile-nav";
import { DocsSidebar } from "@/components/docs/docs-sidebar";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    // The docs exist in English only, also under /tr: `lang` says so, for
    // screen readers and so that the sidebar's upper-cased section labels follow
    // English rules (under lang="tr" an upper-cased "i" becomes a dotted capital).
    <div
      lang="en"
      className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:px-8 md:grid-cols-[210px_minmax(0,1fr)]"
    >
      <aside className="hidden md:block">
        <div className="sticky top-20">
          <DocsSidebar />
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        {/* Below md the sidebar column is hidden; this opens the same nav. */}
        <DocsMobileNav />
        <DocsBreadcrumb />
        <article className="flex min-w-0 flex-col gap-4">{children}</article>
      </div>
    </div>
  );
}
