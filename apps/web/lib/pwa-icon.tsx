import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";

// public/logo.png is 582 × 653: the mark is taller than it is wide, so the file
// itself can never be the square icon a web manifest asks for.
const LOGO_ASPECT = 582 / 653;

/**
 * The AvaKit mark centred on a square white field, as a PNG of exactly
 * `size` × `size` pixels, the same treatment app/apple-icon.tsx gives the touch
 * icon (the logo art is black on transparent).
 *
 * `fill` is the share of the square's height the mark takes. A maskable icon
 * may be cropped to a circle 80% of the square wide, so it needs a smaller mark
 * than a plain one.
 */
export function pwaIcon(size: number, fill: number) {
  const logo = readFileSync(path.join(process.cwd(), "public/logo.png"));
  const src = `data:image/png;base64,${logo.toString("base64")}`;
  const height = Math.round(size * fill);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#ffffff",
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: satori (ImageResponse) only supports <img> */}
      <img
        src={src}
        width={Math.round(height * LOGO_ASPECT)}
        height={height}
        alt="AvaKit"
        style={{ objectFit: "contain" }}
      />
    </div>,
    { width: size, height: size },
  );
}
