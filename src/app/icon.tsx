import { ImageResponse } from "next/og";
import { FaviconMark } from "@/components/brand/Mark548";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** The bracket alone, white on ink: the mark at favicon size. */
export default async function Icon() {
  return new ImageResponse(<FaviconMark size={32} />, { ...size });
}
