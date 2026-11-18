import { pwaIcon } from "@/lib/pwa-icon";

// Rendered once at build time, like the other metadata images.
export const dynamic = "force-static";

// A launcher may crop a maskable icon to a circle 80% of its width, so the mark
// stays well inside that.
export function GET() {
  return pwaIcon(512, 0.5);
}
