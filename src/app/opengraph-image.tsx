import { ImageResponse } from "next/og";
import { Mark548 } from "@/components/brand/Mark548";
import { BRAND_IMAGE_FONT, brandFonts } from "@/app/brand-image";

export const alt = "548: NBA forecasts, updated through the day.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: 72,
          background: "#ffffff",
          fontFamily: BRAND_IMAGE_FONT,
          color: "#111111",
        }}
      >
        <Mark548 height={140} />
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 68, lineHeight: 1.05, letterSpacing: -2, maxWidth: 960 }}>
            NBA forecasts, updated through the day.
          </div>
          <div style={{ display: "flex", fontSize: 28, color: "#666666", letterSpacing: -0.5 }}>
            Every game&apos;s win probability, sealed before tip and scored in public.
          </div>
        </div>
        <div style={{ display: "flex", height: 8, width: 120, background: "#111111" }} />
      </div>
    ),
    { ...size, fonts: await brandFonts() },
  );
}
