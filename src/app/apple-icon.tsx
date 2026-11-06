import { ImageResponse } from "next/og";
import { AppMark } from "@/components/brand/Mark548";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS rounds the corners itself, so the tile fills the square edge to edge.
export default async function AppleIcon() {
  return new ImageResponse(<AppMark size={180} />, { ...size });
}
