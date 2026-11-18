import type { Metadata } from "next";
import type { ReactNode } from "react";

import { pageMetadata } from "@/lib/metadata";

// The page is a client component, which cannot export metadata, so its
// metadata lives in this pass-through layout.
export const metadata: Metadata = pageMetadata({
  route: "/avatar",
  title: "3D mascots",
  description:
    "Meet AvaFox and the Obsidian Core, AvaKit's two 3D mascots: orbit them in the browser, copy the embed snippet, or download the glTF.",
});

export default function AvatarLayout({ children }: { children: ReactNode }) {
  return children;
}
