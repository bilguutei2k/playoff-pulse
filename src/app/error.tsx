"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import { PageStamp } from "@/components/live/FreshnessGuard";

const DESTINATIONS = [
  { href: "/", label: "Today's games" },
  { href: "/odds", label: "Odds" },
  { href: "/teams", label: "Teams" },
  { href: "/players", label: "Players" },
];

/**
 * A page that failed to render (NAV-17). The masthead and footer stay; the reader gets a
 * plain explanation, a retry that asks the server for the page again, and ways on.
 * Never shows the error itself.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    // Kept for the browser console; the reader sees only the message below.
    console.error(error);
  }, [error]);

  const retry = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <main className="pp-container pb-8 pt-12 sm:pt-20">
      <PageStamp generatedAt={null} />
      <div className="max-w-2xl">
        <p className="kicker">Something went wrong</p>
        <h1 className="headline mt-2 text-32 sm:text-46">This page could not be shown</h1>
        <p className="mt-3 text-[15px] text-ink-2">
          Part of this page failed to load. Trying again usually fixes it; if it does not, the rest of the site is
          a click away.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={retry} className="pp-button pp-button-primary min-h-11">
            Try again
          </button>
          <Link href="/" className="pp-button min-h-11">
            Go to today&apos;s games
          </Link>
        </div>
      </div>
      <nav aria-label="Other pages" className="mt-10 max-w-3xl">
        <ul className="grid border-t-2 border-ink sm:grid-cols-4 sm:gap-x-8">
          {DESTINATIONS.map(({ href, label }) => (
            <li key={href} className="border-b border-line">
              <Link href={href} className="flex min-h-11 items-center py-2 text-17 font-semibold hover:underline hover:underline-offset-4">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
