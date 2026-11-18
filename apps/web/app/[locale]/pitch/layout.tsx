import type { Metadata } from "next";
import type { ReactNode } from "react";

import { pageMetadata } from "@/lib/metadata";

// The page is a client component, which cannot export metadata, so its
// metadata lives in this pass-through layout.
export const metadata: Metadata = {
  ...pageMetadata({
    route: "/pitch",
    title: "Pitch deck",
    description:
      "AvaKit in eight slides: the problem, the toolkit, how it works, the AI-native wedge, the templates, the traction, and the ask.",
  }),
  // A deck to hand to someone, not a page to be found: it is linked from
  // nowhere and left out of the sitemap, so keep it out of search results too.
  // (Its old canonical pointed at the home page, which had the same effect.)
  robots: { index: false, follow: true },
};

export default function PitchLayout({ children }: { children: ReactNode }) {
  return children;
}
