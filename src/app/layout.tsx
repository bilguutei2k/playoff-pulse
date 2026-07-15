import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/layout/Header";

export const metadata: Metadata = {
  title: "Playoff Pulse",
  description:
    "Transparent NBA playoff forecast using exact series solving, uncertainty-aware bracket simulation, and manual inputs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Header />
        {children}
      </body>
    </html>
  );
}
