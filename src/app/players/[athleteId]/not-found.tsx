import Link from "next/link";
import { SectionHeading } from "@/components/live/SectionHeading";

/** A player ID that no published file knows (VB-13). The title comes from the page's generateMetadata. */
export default function PlayerNotFound() {
  return (
    <main className="pp-container pb-16 pt-7 sm:pt-11">
      <nav aria-label="Breadcrumb" className="mb-[22px] text-13">
        <Link href="/players" className="text-ink-2 hover:text-ink">
          <span aria-hidden>← </span>All players
        </Link>
      </nav>
      <SectionHeading as="h1" kicker="Not found" title="No player with that ID" />
      <p className="mt-3 max-w-[64ch] text-15 leading-6 text-ink-2">
        548 knows a player once a stored box score or an NBA injury report lists him this season. The link may be
        mistyped, or he has not appeared yet.
      </p>
      <p className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-15">
        <Link href="/players" className="pp-link">All players</Link>
        <Link href="/injuries" className="pp-link">Injuries</Link>
        <Link href="/teams" className="pp-link">All teams</Link>
      </p>
    </main>
  );
}
