"use client";

import { PanelLeft } from "lucide-react";
import { useState } from "react";

import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/**
 * The docs navigation for small screens. The sidebar column only exists from
 * `md` up, so below that the same list opens in a sheet from this button.
 */
export function DocsMobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="mb-4 w-fit md:hidden">
          <PanelLeft />
          Docs menu
        </Button>
      </SheetTrigger>
      <SheetContent side="left" aria-describedby={undefined} className="overflow-y-auto">
        <SheetTitle>Documentation</SheetTitle>
        <DocsSidebar onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
