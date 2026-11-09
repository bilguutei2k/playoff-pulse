import type { Metadata, Viewport } from "next";
import "./globals.css";
import { schibsted } from "@/app/fonts";
import { Header } from "@/components/layout/Header";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { FreshnessGuard } from "@/components/live/FreshnessGuard";
import { getLiveState } from "@/lib/live-data/published";

const SITE_URL = "https://548-sable.vercel.app";

// Every page carries the header's "Updated N min ago" chip, read from the published state
// at render time (src/lib/live-data/published.ts), so every page is regenerated about once
// a minute; the CDN may serve the previous copy for up to `expireTime` (next.config.ts)
// past that, and FreshnessGuard below asks the server for a newer one when the copy a
// reader got lags it. Data commits do not deploy.
export const revalidate = 60;
const TAGLINE = "NBA forecasts, updated through the day.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `548 · ${TAGLINE}`, template: "%s · 548" },
  description:
    "Win probabilities for every NBA game, sealed before tip and scored in public, with playoff and title odds for all 30 teams.",
  applicationName: "548",
  openGraph: { siteName: "548", type: "website", url: SITE_URL },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#111111",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const liveState = await getLiveState();
  return (
    <html
      lang="en"
      className={schibsted.variable}
    >
      <body className="flex min-h-screen flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:bg-panel focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:outline focus:outline-2 focus:outline-ink"
        >
          Skip to content
        </a>
        <Header />
        <div id="main" className="flex-1">
          <FreshnessGuard generatedAt={liveState.generatedAt} />
          {children}
        </div>
        <SiteFooter />
      </body>
    </html>
  );
}
