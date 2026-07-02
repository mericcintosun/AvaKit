"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/** Click cycles the theme in order: system → light → dark → system. */
const ORDER = ["system", "light", "dark"] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Avoid a hydration mismatch: render a stable icon until mounted.
  const current = (mounted ? (theme ?? "system") : "system") as (typeof ORDER)[number];
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor;

  const cycle = () => setTheme(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]);

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={`Theme: ${current}. Click to switch.`}
      title={`Theme: ${current}`}
      onClick={cycle}
    >
      <Icon className="size-[1.2rem]" />
      <span className="sr-only">Toggle theme (currently {current})</span>
    </Button>
  );
}
