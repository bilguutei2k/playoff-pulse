"use client";

import { useEffect } from "react";
import "./globals.css";
import { schibsted } from "@/app/fonts";
import { Mark548 } from "@/components/brand/Mark548";

/**
 * The last resort (NAV-17): the root layout itself failed, so this replaces it and must
 * draw its own <html>, masthead strip and styles. Plain links, so "Try again" and "home"
 * load the page afresh rather than through a router that may be what broke.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className={schibsted.variable}>
      <head>
        <title>Something went wrong · 548</title>
        <meta name="robots" content="noindex" />
      </head>
      <body className="flex min-h-screen flex-col antialiased">
        <header className="bg-masthead text-white">
          <div className="pp-container flex h-14 items-center lg:h-[68px]">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load on purpose */}
            <a href="/" aria-label="548, NBA forecasts: today's games" className="flex items-center">
              <Mark548 height={26} tone="light" />
            </a>
          </div>
        </header>
        <main className="pp-container flex-1 pb-12 pt-12 sm:pt-20">
          <div className="max-w-2xl">
            <p className="kicker">Something went wrong</p>
            <h1 className="headline mt-2 text-32 sm:text-46">548 could not load this page</h1>
            <p className="mt-3 text-[15px] text-ink-2">
              Something failed before the page could be drawn. Loading it again usually fixes it.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="pp-button pp-button-primary min-h-11"
              >
                Try again
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load on purpose */}
              <a href="/" className="pp-button min-h-11">
                Go to today&apos;s games
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
