// Shared loader for the icon and share images: Archivo Black from the committed TTF.

import { readFile } from "node:fs/promises";
import path from "node:path";

export const BRAND_IMAGE_FONT = "Archivo Black";

export async function brandFonts() {
  const data = await readFile(path.join(process.cwd(), "src/app/fonts/ArchivoBlack-Regular.ttf"));
  return [{ name: BRAND_IMAGE_FONT, data, style: "normal" as const, weight: 400 as const }];
}
