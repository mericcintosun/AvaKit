import type { ReactNode } from "react";

import { DocsBreadcrumb } from "@/components/docs/docs-breadcrumb";
import { DocsSidebar } from "@/components/docs/docs-sidebar";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:px-8 md:grid-cols-[210px_minmax(0,1fr)]">
      <aside className="hidden md:block">
        <div className="sticky top-20">
          <DocsSidebar />
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <DocsBreadcrumb />
        <article className="flex min-w-0 flex-col gap-4">{children}</article>
      </div>
    </div>
  );
}
