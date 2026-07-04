/**
 * AvaKit terminal banner — an ASCII mountain (Avalanche) + a block-letter
 * AVAKIT wordmark. Self-contained: raw ANSI, no dependencies. Color auto-disables
 * when the stream is not a TTY, or when NO_COLOR / FORCE_COLOR=0 is set — the
 * de-facto standards (https://no-color.org). Shared, byte-for-byte, across the
 * AvaKit CLIs so every terminal session carries the same brand.
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const WHITE = "\x1b[97m";

function fg(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

// A hand-drawn ASCII mountain — the white "snow cap" above the wordmark.
const MOUNTAIN = [
  "        /\\",
  "       /  \\",
  "      / /\\ \\",
  "     / /  \\ \\",
  "    /_/____\\_\\",
];

// "AVAKIT" in the ANSI Shadow figlet font.
const WORDMARK = [
  " █████╗ ██╗   ██╗ █████╗ ██╗  ██╗██╗████████╗",
  "██╔══██╗██║   ██║██╔══██╗██║ ██╔╝██║╚══██╔══╝",
  "███████║██║   ██║███████║█████╔╝ ██║   ██║",
  "██╔══██║╚██╗ ██╔╝██╔══██║██╔═██╗ ██║   ██║",
  "██║  ██║ ╚████╔╝ ██║  ██║██║  ██╗██║   ██║",
  "╚═╝  ╚═╝  ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝",
];

const TAGLINE = "    Avalanche, one command.";

// Ember Crimson gradient down the wordmark: rose-400 (peak) → rose-800 (base).
function crimsonAt(t: number): [number, number, number] {
  const a: [number, number, number] = [251, 113, 133];
  const b: [number, number, number] = [159, 18, 57];
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Whether to emit ANSI color for a given stream. */
export function bannerColor(stream: { isTTY?: boolean }): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(stream.isTTY);
}

function paint(color: boolean, codes: string, text: string): string {
  return color ? codes + text + RESET : text;
}

/** The full multi-line banner (mountain + AVAKIT wordmark + tagline). */
export function banner(color = true): string {
  const out: string[] = [""];
  for (const line of MOUNTAIN) out.push(paint(color, BOLD + WHITE, line));
  out.push("");
  WORDMARK.forEach((line, i) => {
    const t = WORDMARK.length > 1 ? i / (WORDMARK.length - 1) : 0;
    const [r, g, b] = crimsonAt(t);
    out.push(paint(color, BOLD + fg(r, g, b), line));
  });
  out.push(paint(color, DIM, TAGLINE));
  out.push("");
  return out.join("\n");
}

/** A single-line variant for tight / log contexts. */
export function bannerLine(color = true): string {
  return [
    paint(color, BOLD + fg(225, 29, 72), "▲"),
    paint(color, BOLD + WHITE, "AvaKit"),
    paint(color, DIM, "· Avalanche, one command."),
  ].join(" ");
}
