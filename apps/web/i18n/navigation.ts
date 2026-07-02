import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware navigation helpers — use these instead of next/link / next/navigation
// so links keep the active locale (and add the /tr prefix when needed).
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
