import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export const metadata: Metadata = { title: "Page not found" };

/** The 404 page, for a path no page matches ([...rest]/page.tsx). English only, like the docs. */
export default function NotFound() {
  return (
    <div
      lang="en"
      className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-5 py-24 sm:px-8 sm:py-32"
    >
      <span className="text-muted-foreground font-mono text-xs tracking-[0.2em] uppercase">
        404
      </span>
      <h1 className="text-4xl font-semibold tracking-tight">This page could not be found.</h1>
      <p className="text-muted-foreground text-balance">
        The link may be out of date, or the address mistyped.
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/">Go to the home page</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/docs">Read the docs</Link>
        </Button>
      </div>
    </div>
  );
}
