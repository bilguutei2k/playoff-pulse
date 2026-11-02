import { ImageResponse } from "next/og";
import { Brand548 } from "@/components/brand/Brand548";
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
          background: "#faf9f7",
          fontFamily: BRAND_IMAGE_FONT,
          color: "#121417",
        }}
      >
        <Brand548 size={168} fontFamily={BRAND_IMAGE_FONT} />
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 68, lineHeight: 1.05, letterSpacing: -2, maxWidth: 960 }}>
            NBA forecasts, updated through the day.
          </div>
          <div style={{ display: "flex", fontSize: 28, color: "#5c5a57", letterSpacing: -0.5 }}>
            Every game&apos;s win probability, sealed before tip and scored in public.
          </div>
        </div>
        <div style={{ display: "flex", height: 8, width: 120, background: "#ff5a1f" }} />
      </div>
    ),
    { ...size, fonts: await brandFonts() },
  );
}
