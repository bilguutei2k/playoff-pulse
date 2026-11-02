import { ImageResponse } from "next/og";
import { Brand548 } from "@/components/brand/Brand548";
import { BRAND_IMAGE_FONT, brandFonts } from "@/app/brand-image";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
  return new ImageResponse(<Brand548 size={32} fontFamily={BRAND_IMAGE_FONT} />, {
    ...size,
    fonts: await brandFonts(),
  });
}
