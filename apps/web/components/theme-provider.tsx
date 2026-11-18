"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type * as React from "react";

import { MotionProvider } from "@/components/motion";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...props}>
      {/* The root layout mounts this provider around every page, which makes it
          the one place that can switch reduced-motion support on site-wide. */}
      <MotionProvider>{children}</MotionProvider>
    </NextThemesProvider>
  );
}
