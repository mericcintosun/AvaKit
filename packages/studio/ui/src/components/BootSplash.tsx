import { useCallback, useEffect, useState } from "react";

/**
 * BootSplash — a fun, terminal-styled boot splash for AvaKit Studio.
 *
 * A full-screen dark terminal overlay that shows the AvaKit stacked-triangle
 * mountain logo (snow-capped: top two rows white, lower rows Ember Crimson),
 * a wordmark, and a short staggered fake boot log. It auto-dismisses after
 * ~1.8s and is skippable on any click or keypress.
 *
 * It shows ONLY ONCE per browser session: gated on a sessionStorage flag so
 * re-renders and the dashboard's 5s status polling never re-trigger it.
 *
 * The splash is intentionally always the dark terminal look, regardless of the
 * app's light/dark theme — CSS animations only, no dependencies.
 */

const SESSION_KEY = "avakit-studio-booted";

// Ember Crimson, matched to the website's dark-mode --primary token.
const CRIMSON = "oklch(0.66 0.2 25.3)";

// The shared AvaKit logo — a hand-drawn ASCII mountain (snow) above the
// block-letter AVAKIT wordmark (ANSI Shadow figlet). Leading spaces matter.
const MOUNTAIN_ROWS = [
  "        /\\",
  "       /  \\",
  "      / /\\ \\",
  "     / /  \\ \\",
  "    /_/____\\_\\",
];
const WORDMARK_ROWS = [
  " █████╗ ██╗   ██╗ █████╗ ██╗  ██╗██╗████████╗",
  "██╔══██╗██║   ██║██╔══██╗██║ ██╔╝██║╚══██╔══╝",
  "███████║██║   ██║███████║█████╔╝ ██║   ██║",
  "██╔══██║╚██╗ ██╔╝██╔══██║██╔═██╗ ██║   ██║",
  "██║  ██║ ╚████╔╝ ██║  ██║██║  ██╗██║   ██║",
  "╚═╝  ╚═╝  ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝",
];

const BOOT_LINES = [
  "> booting AvaKit Studio…",
  "> detecting Avalanche toolchain…",
  "> starting local control center…",
];

export function BootSplash() {
  // Only show if we haven't booted yet this session. Read synchronously so the
  // splash never flashes on subsequent renders.
  const [visible, setVisible] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) === null;
    } catch {
      return false;
    }
  });
  const [closing, setClosing] = useState(false);

  const dismiss = useCallback(() => {
    // Mark as booted immediately so nothing can re-trigger the splash.
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* sessionStorage unavailable — just close */
    }
    setClosing(true);
    // Remove from the tree after the fade-out completes.
    window.setTimeout(() => setVisible(false), 320);
  }, []);

  useEffect(() => {
    if (!visible) return;
    // Auto-dismiss after ~1.8s.
    const timer = window.setTimeout(dismiss, 1800);
    const onKey = () => dismiss();
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [visible, dismiss]);

  if (!visible) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: full-screen click-to-skip overlay; keyboard skip is handled by a window keydown listener
    <div
      onClick={dismiss}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.75rem",
        background: "#08090b",
        color: "#e5e7eb",
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
        cursor: "pointer",
        overflow: "hidden",
        animation: closing ? "avakit-boot-fade 0.32s ease forwards" : undefined,
      }}
    >
      {/* Scoped keyframes + effects — self-contained, no global CSS needed. */}
      <style>{`
        @keyframes avakit-boot-fade { from { opacity: 1 } to { opacity: 0 } }
        @keyframes avakit-boot-line {
          from { opacity: 0; transform: translateY(4px) }
          to { opacity: 1; transform: translateY(0) }
        }
        @keyframes avakit-boot-logo {
          from { opacity: 0; transform: translateY(8px) scale(0.98) }
          to { opacity: 1; transform: translateY(0) scale(1) }
        }
        @keyframes avakit-boot-cursor { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
        .avakit-boot-line { animation: avakit-boot-line 0.35s ease both }
        .avakit-boot-cursor {
          display: inline-block;
          animation: avakit-boot-cursor 0.9s steps(1) infinite;
        }
      `}</style>

      {/* Vignette + subtle scanlines (pointer-events off so clicks pass through). */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(120% 120% at 50% 40%, transparent 55%, rgba(0,0,0,0.65) 100%)",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.35,
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 3px)",
        }}
      />

      {/* Logo */}
      <pre
        role="img"
        aria-label="AvaKit"
        style={{
          margin: 0,
          lineHeight: 1.05,
          fontSize: "clamp(0.7rem, 2.6vw, 1.15rem)",
          textAlign: "left",
          animation: "avakit-boot-logo 0.5s ease both",
          textShadow: `0 0 18px ${CRIMSON}`,
          position: "relative",
        }}
      >
        {MOUNTAIN_ROWS.map((row) => (
          <div key={row} style={{ color: "#ffffff" }}>
            {row}
          </div>
        ))}
        {WORDMARK_ROWS.map((row) => (
          <div key={row} style={{ color: CRIMSON }}>
            {row}
          </div>
        ))}
      </pre>

      {/* Tagline */}
      <div
        style={{
          textAlign: "center",
          position: "relative",
          fontSize: "0.75rem",
          color: "#8b8f98",
        }}
      >
        Avalanche, one command.
      </div>

      {/* Boot log — lines reveal in a staggered sequence. */}
      <div
        style={{
          position: "relative",
          fontSize: "0.8rem",
          color: "#a9adb6",
          textAlign: "left",
          minWidth: "min(20rem, 80vw)",
          lineHeight: 1.9,
        }}
      >
        {BOOT_LINES.map((line, i) => (
          <div
            key={line}
            className="avakit-boot-line"
            style={{ animationDelay: `${0.35 + i * 0.35}s` }}
          >
            {line}
          </div>
        ))}
        <div
          className="avakit-boot-line"
          style={{ animationDelay: `${0.35 + BOOT_LINES.length * 0.35}s`, color: "#e5e7eb" }}
        >
          {"> ready "}
          <span className="avakit-boot-cursor" style={{ color: CRIMSON }}>
            {"▉"}
          </span>
        </div>
      </div>

      {/* Skip hint */}
      <div
        style={{
          position: "absolute",
          bottom: "1.5rem",
          fontSize: "0.7rem",
          color: "#565a63",
          letterSpacing: "0.05em",
        }}
      >
        press any key to skip
      </div>
    </div>
  );
}
