import type { Metadata } from "next";
import type { ReactNode } from "react";

import { pageMetadata } from "@/lib/metadata";

// The page is a client component, which cannot export metadata, so its
// metadata lives in this pass-through layout.
export const metadata: Metadata = pageMetadata({
  route: "/pitch",
  title: "Pitch deck",
  description:
    "AvaKit in eight slides: the problem, the toolkit, how it works, the AI-native wedge, the templates, the traction, and the ask.",
});

export default function PitchLayout({ children }: { children: ReactNode }) {
  return children;
}
