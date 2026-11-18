import { pwaIcon } from "@/lib/pwa-icon";

// Rendered once at build time, like the other metadata images.
export const dynamic = "force-static";

export function GET() {
  return pwaIcon(192, 0.7);
}
