// One type family. Schibsted Grotesk sets everything, figures included (tabular
// numerals through `font-variant-numeric`). The 548 mark is outlined paths, so it
// needs no font. Archivo Black stays only for the share image's text, as a committed
// OFL file (see fonts/ArchivoBlack-OFL.txt) that ImageResponse can load.

import { Schibsted_Grotesk } from "next/font/google";
import localFont from "next/font/local";

export const schibsted = Schibsted_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-schibsted",
  weight: "variable",
});

// Tabular figures without spread-out punctuation. Schibsted's tabular set (tnum) also
// swaps the period, comma, colon and semicolon for digit-wide copies, so "+0.8" read
// "+0 . 8" in a table. This is the same Latin file with only those four substitutions
// removed (see fonts/SchibstedGrotesk-OFL.txt); base.css puts it first in the stack
// wherever figures are tabular, so digits still line up and decimals sit tight. Not
// preloaded: it loads on the first page that shows a tabular figure.
export const figures = localFont({
  src: "./fonts/SchibstedGroteskFigures.woff2",
  variable: "--font-figures",
  weight: "400 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});
