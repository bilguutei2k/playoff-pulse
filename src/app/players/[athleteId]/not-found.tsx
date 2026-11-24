import { SiteLink } from "@/components/layout/SiteLink";
import { SectionHeading } from "@/components/live/SectionHeading";

// A 404 takes its title from here, not from the page's generateMetadata.
export const metadata = { title: "Player not found", robots: { index: false } };

/** A player ID that no published file knows (VB-13). */
export default function PlayerNotFound() {
  return (
    <main className="pp-container pb-16 pt-7 sm:pt-11">
      <nav aria-label="Breadcrumb" className="mb-[22px] text-13">
        <SiteLink href="/players" className="back-link text-ink-2 hover:text-ink">
          <span aria-hidden>← </span>All players
        </SiteLink>
      </nav>
      <SectionHeading as="h1" kicker="Not found" title="No player with that ID" />
      <p className="mt-3 max-w-[64ch] text-15 leading-6 text-ink-2">
        548 knows a player once a stored box score or an NBA injury report lists him this season. The link may be
        mistyped, or he has not appeared yet.
      </p>
      <p className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-15">
        <SiteLink href="/players" className="pp-link">All players</SiteLink>
        <SiteLink href="/injuries" className="pp-link">Injuries</SiteLink>
        <SiteLink href="/teams" className="pp-link">All teams</SiteLink>
      </p>
    </main>
  );
}
