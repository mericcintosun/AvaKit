import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";

// Apple touch icon (home-screen). iOS applies its own rounded mask, so we render
// the AvaKit mark on a full-bleed white field (the logo art is black-on-transparent).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const logo = readFileSync(path.join(process.cwd(), "public/logo.png"));
  const src = `data:image/png;base64,${logo.toString("base64")}`;
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
      <img src={src} width={116} height={128} alt="AvaKit" style={{ objectFit: "contain" }} />
    </div>,
    { ...size },
  );
}
