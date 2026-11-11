import type { Metadata, Viewport } from "next";
import { Fragment } from "react";
import "./globals.css";
import { figures, schibsted } from "@/app/fonts";
import { Header } from "@/components/layout/Header";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { NavProgress } from "@/components/layout/NavProgress";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { FreshnessGuard } from "@/components/live/FreshnessGuard";
import { getLiveState } from "@/lib/live-data/published";
import { SITE_URL } from "@/lib/view/routes";

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
  // No openGraph.url here: each page sets its own canonical URL (alternates.canonical,
  // relative to metadataBase), so a shared link never claims to be the homepage.
  openGraph: { siteName: "548", type: "website" },
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
      className={`${schibsted.variable} ${figures.variable}`}
      // base.css scrolls smoothly for in-page anchors; this tells Next to jump, not glide, on route changes.
      data-scroll-behavior="smooth"
    >
      <body className="flex min-h-screen flex-col antialiased">
        {/* Everything in <body> sits under the gate: see HydrationGate for the hydration failure it prevents. */}
        <HydrationGate>
          <NavProgress />
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:bg-panel focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:outline focus:outline-2 focus:outline-ink"
          >
            Skip to content
          </a>
          <Header />
          <div id="main" className="flex-1">
            {/*
              Keep this keyed Fragment. The children slot can arrive as an element still waiting
              for the error page's client module (src/app/error.tsx), even after the document has
              parsed. Directly inside a DOM element, React 19.2 suspends there and, on resuming,
              claims div#main a second time from a cursor already inside it (#418, "<main> where
              div#main", shifted useId values). Under a Fragment the unit that resumes is the
              Fragment, which claims no DOM node.
            */}
            <Fragment key="main">
              <FreshnessGuard generatedAt={liveState.generatedAt} />
              {children}
            </Fragment>
          </div>
          <SiteFooter />
        </HydrationGate>
      </body>
    </html>
  );
}
