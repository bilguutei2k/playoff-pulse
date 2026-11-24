import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Fragment } from "react";
import "./globals.css";
import { figures, schibsted } from "@/app/fonts";
import { BackToTop } from "@/components/layout/BackToTop";
import { Header } from "@/components/layout/Header";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { NavProgress } from "@/components/layout/NavProgress";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { FreshnessGuard } from "@/components/live/FreshnessGuard";
import { getDelivery, getLiveState } from "@/lib/live-data/published";
import { SITE_URL } from "@/lib/view/routes";

// Every page renders at request time: `await connection()` below is the first statement
// of RootLayout, so every route under it is dynamic and none has a build-time copy. Under
// incremental regeneration, once a route's runtime copy was more than `expireTime`
// (next.config.ts) old, Vercel served the copy built at deploy time (`x-vercel-cache:
// PRERENDER`) to readers and the watchdog, days behind the published state (2026-11-14 to
// 16). Data commits do not deploy, so a build-time copy is always wrong for live data.
//
// Trap: never export `revalidate`, `dynamicParams` or `generateStaticParams` from a page
// or this layout. With `connection()` here they make every dynamic-segment URL
// (/games/…, /teams/…, /players/…, /game/…) answer 500 DYNAMIC_SERVER_USAGE, and the build
// still passes. `verify:rendering` (scripts/verify/rendering.ts) fails on both.
// FreshnessGuard below still covers copies a reader keeps (an open tab, a back-forward
// restore, the client router cache).
const TAGLINE = "NBA forecasts, updated through the day.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `548 · ${TAGLINE}`, template: "%s · 548" },
  description:
    "Win probabilities for every NBA game, with playoff and title odds for all 30 teams. Forecasts sealed before tip are scored in public, and missed seals are counted.",
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
  await connection();
  const [liveState, { delivery }] = await Promise.all([getLiveState(), getDelivery()]);
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
              <FreshnessGuard generatedAt={liveState.generatedAt} delivery={delivery} />
              {children}
            </Fragment>
          </div>
          <SiteFooter />
          <BackToTop />
        </HydrationGate>
      </body>
    </html>
  );
}
