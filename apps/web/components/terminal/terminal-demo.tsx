"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { usePrefersReducedMotion } from "@/components/use-media-query";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/* Standalone, playful terminal-themed page.
   The window is intentionally always-dark: it is wrapped in a `dark` class so
   every design token (background, foreground, primary/crimson) resolves to its
   dark-theme value — no hardcoded colors, matching the repo's token rule. The
   three window-chrome lights are tokens too (--terminal-* in globals.css). */

// The shared AvaKit logo: a hand-drawn ASCII mountain (in the foreground tone,
// like snow) above the block-letter AVAKIT wordmark (ANSI Shadow figlet, tinted
// crimson).
const MOUNTAIN_ROWS = [
  "        /\\",
  "       /  \\",
  "      / /\\ \\",
  "     / /  \\ \\",
  "    /_/____\\_\\",
] as const;
const WORDMARK_ROWS = [
  " █████╗ ██╗   ██╗ █████╗ ██╗  ██╗██╗████████╗",
  "██╔══██╗██║   ██║██╔══██╗██║ ██╔╝██║╚══██╔══╝",
  "███████║██║   ██║███████║█████╔╝ ██║   ██║",
  "██╔══██║╚██╗ ██╔╝██╔══██║██╔═██╗ ██║   ██║",
  "██║  ██║ ╚████╔╝ ██║  ██║██║  ██╗██║   ██║",
  "╚═╝  ╚═╝  ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝",
] as const;

const COMMAND = "npm create avalanche-app@latest";

type Tone = "muted" | "ok" | "brand";

// The simulated scaffolder run, revealed line by line after the command types.
// It follows the real wizard in packages/create-avalanche-app/src/ui/wizard.tsx:
// the same four questions with the same labels and displayed values, then the
// result lines it prints. Keep the two in step — in particular the file count,
// which is what the nft-mint template scaffolds today.
const OUTPUT: { text: string; tone: Tone; icon: string }[] = [
  { icon: "◇", text: "Project name › my-app", tone: "muted" },
  { icon: "◇", text: "Template › NFT mint", tone: "muted" },
  { icon: "◇", text: "Network › Fuji testnet", tone: "muted" },
  { icon: "◇", text: "Package manager › pnpm", tone: "muted" },
  { icon: "✓", text: "Created 19 files", tone: "ok" },
  { icon: "✓", text: "Dependencies installed", tone: "ok" },
  { icon: "▲", text: "Your Avalanche dapp is ready.", tone: "brand" },
  { icon: "$", text: "cd my-app && pnpm run dev", tone: "muted" },
];

const toneClass: Record<Tone, string> = {
  muted: "text-muted-foreground",
  ok: "text-foreground",
  brand: "text-primary font-medium",
};

const iconClass: Record<Tone, string> = {
  muted: "text-primary/70",
  ok: "text-primary",
  brand: "text-primary",
};

// A steady blinking block cursor; a solid block when motion is reduced.
function Cursor({ className }: { className?: string }) {
  const still = usePrefersReducedMotion();
  const block = cn("bg-primary inline-block h-[1.05em] w-[0.6ch] translate-y-[0.15em]", className);
  if (still) return <span aria-hidden className={block} />;
  return (
    <motion.span
      aria-hidden
      className={block}
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ duration: 1, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
    />
  );
}

function Logo() {
  return (
    <pre
      role="img"
      aria-label="AvaKit logo"
      className="leading-[1.1] font-bold [text-shadow:0_0_18px_var(--brand)]"
    >
      {MOUNTAIN_ROWS.map((row) => (
        <span key={row} className="text-foreground block">
          {row}
        </span>
      ))}
      {WORDMARK_ROWS.map((row) => (
        <span key={row} className="text-primary block">
          {row}
        </span>
      ))}
    </pre>
  );
}

export function TerminalDemo() {
  // Typewriter for the command line.
  const [typed, setTyped] = useState(0);
  const commandDone = typed >= COMMAND.length;
  const still = usePrefersReducedMotion();

  // `typed` must stay in the deps: each change re-runs this effect to schedule
  // the next keystroke — dropping it would freeze the typewriter after one char.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional cadence
  useEffect(() => {
    if (commandDone) return;
    // Reduced motion: no keystroke-by-keystroke reveal, just the finished line.
    if (still) {
      setTyped(COMMAND.length);
      return;
    }
    const id = setTimeout(() => setTyped((n) => n + 1), 55);
    return () => clearTimeout(id);
  }, [typed, commandDone, still]);

  return (
    <div className="w-full">
      {/* dark → force dark tokens so the window stays near-black in either theme */}
      <div className="dark bg-background text-foreground overflow-hidden rounded-xl border shadow-2xl">
        {/* Title bar */}
        <div className="border-border/80 bg-foreground/[0.03] flex items-center gap-2 border-b px-4 py-3">
          <div className="flex gap-2">
            <span className="bg-terminal-close size-3 rounded-full" />
            <span className="bg-terminal-minimize size-3 rounded-full" />
            <span className="bg-terminal-zoom size-3 rounded-full" />
          </div>
          <span className="text-muted-foreground mx-auto pr-8 font-mono text-xs">avakit — zsh</span>
        </div>

        {/* Content — scrolls horizontally on small screens */}
        <div className="overflow-x-auto">
          <div className="min-w-max p-5 font-mono text-[13px] leading-relaxed sm:p-7 sm:text-sm">
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <Logo />
            </motion.div>

            <div className="text-muted-foreground mt-4 mb-6 text-xs tracking-wide">
              Avalanche, one command.
            </div>

            {/* Typed command line */}
            <div className="whitespace-pre">
              <span className="text-primary select-none">{"➜  "}</span>
              <span className="text-muted-foreground select-none">~ </span>
              <span>{COMMAND.slice(0, typed)}</span>
              {!commandDone && <Cursor />}
            </div>

            {/* Simulated output, staggered in after the command finishes typing */}
            <AnimatePresence>
              {commandDone && (
                <motion.div
                  className="mt-3 flex flex-col gap-1.5"
                  initial="hidden"
                  animate="show"
                  variants={{
                    // Reduced motion shows the whole run at once, not line by line.
                    show: {
                      transition: still
                        ? { staggerChildren: 0, delayChildren: 0 }
                        : { staggerChildren: 0.28, delayChildren: 0.15 },
                    },
                  }}
                >
                  {OUTPUT.map((line, i) => (
                    <motion.div
                      // biome-ignore lint/suspicious/noArrayIndexKey: output lines are static and ordered
                      key={i}
                      variants={{
                        hidden: { opacity: 0, x: -8 },
                        show: { opacity: 1, x: 0, transition: { duration: 0.3, ease: "easeOut" } },
                      }}
                      className={cn("flex items-start gap-2 whitespace-pre", toneClass[line.tone])}
                    >
                      <span className={cn("select-none", iconClass[line.tone])}>{line.icon}</span>
                      <span>{line.text}</span>
                    </motion.div>
                  ))}

                  {/* Trailing prompt with blinking cursor */}
                  <motion.div
                    variants={{
                      hidden: { opacity: 0 },
                      show: { opacity: 1, transition: { duration: 0.3 } },
                    }}
                    className="mt-1 flex items-center whitespace-pre"
                  >
                    <span className="text-primary select-none">{"➜  "}</span>
                    <span className="text-muted-foreground select-none">~ </span>
                    <Cursor />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* CTA */}
      <motion.div
        className="mt-8 flex flex-col items-center gap-3"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.5, ease: "easeOut" }}
      >
        <Button asChild size="lg">
          <Link href="/">Get started</Link>
        </Button>
        <p className="text-muted-foreground text-xs">
          Scaffold a social-login Avalanche dapp in one command.
        </p>
      </motion.div>
    </div>
  );
}
