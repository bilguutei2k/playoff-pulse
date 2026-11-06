// One type family. Schibsted Grotesk sets everything, figures included (tabular
// numerals through `font-variant-numeric`). The 548 mark is outlined paths, so it
// needs no font. Archivo Black stays only for the share image's text, as a committed
// OFL file (see fonts/ArchivoBlack-OFL.txt) that ImageResponse can load.

import { Schibsted_Grotesk } from "next/font/google";

export const schibsted = Schibsted_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-schibsted",
  weight: "variable",
});
