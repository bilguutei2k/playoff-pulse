// The three type families. Archivo sets the interface, JetBrains Mono every figure
// and label (tabular numerals), and Archivo Black only the 548 wordmark. Archivo
// Black is a committed OFL file (see fonts/ArchivoBlack-OFL.txt) so the icon and
// share images can load the same bytes through ImageResponse.

import { Archivo, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";

export const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-archivo",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
});

export const archivoBlack = localFont({
  src: "./fonts/ArchivoBlack-Regular.ttf",
  display: "block",
  weight: "400",
  variable: "--font-archivo-black",
});
