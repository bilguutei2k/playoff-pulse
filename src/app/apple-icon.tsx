import { ImageResponse } from "next/og";
import { Brand548 } from "@/components/brand/Brand548";
import { BRAND_IMAGE_FONT, brandFonts } from "@/app/brand-image";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS rounds the corners itself, so the tile fills the square edge to edge.
export default async function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: 180, height: 180, background: "#121417" }}>
        <Brand548 size={180} fontFamily={BRAND_IMAGE_FONT} />
      </div>
    ),
    { ...size, fonts: await brandFonts() },
  );
}
