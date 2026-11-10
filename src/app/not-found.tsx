import Link from "next/link";
import { PageStamp } from "@/components/live/FreshnessGuard";

export const metadata = { title: "Page not found", robots: { index: false } };

const DESTINATIONS = [
  { href: "/", label: "Today's games", note: "Every game with 548's win probability" },
  { href: "/odds", label: "Odds", note: "Playoff and title odds for all 30 teams" },
  { href: "/teams", label: "Teams", note: "Ratings, schedules and injuries by team" },
  { href: "/players", label: "Players", note: "Season stats for every player" },
];

export default function NotFound() {
  return (
    <main className="pp-container pb-8 pt-12 sm:pt-20">
      <PageStamp generatedAt={null} />
      <div className="max-w-2xl">
        <p className="kicker">404</p>
        <h1 className="headline mt-2 text-32 sm:text-46">Nothing here</h1>
        <p className="mt-3 text-[15px] text-ink-2">
          That page does not exist. The date may be outside the season, or the game, team or player may be written
          differently. These are good places to start:
        </p>
      </div>
      <ul className="mt-8 grid max-w-3xl border-t-2 border-ink sm:grid-cols-2 sm:gap-x-8">
        {DESTINATIONS.map(({ href, label, note }) => (
          <li key={href} className="border-b border-line">
            <Link href={href} className="group flex min-h-11 flex-col justify-center py-3">
              <span className="text-17 font-semibold group-hover:underline group-hover:underline-offset-4">
                {label} <span aria-hidden>→</span>
              </span>
              <span className="text-[13px] text-ink-2">{note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
