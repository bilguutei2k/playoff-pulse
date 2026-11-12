import type { Metadata } from "next";
import Link from "next/link";
import { PageStamp } from "@/components/live/FreshnessGuard";
import { PlayersTable } from "@/components/live/PlayersTable";
import { SectionHeading } from "@/components/live/SectionHeading";
import { getLiveState, getPlayerIndex, getTeamInjuryLists } from "@/lib/live-data/published";
import { SEASON_TEAMS } from "@/lib/season/teams";
import { formatLongDay } from "@/lib/utils/dates";
import { playerTableRows } from "@/lib/view/players";
import { teamDisplay } from "@/lib/view/teams";
import { Ticker } from "@/components/live/Ticker";

export const metadata: Metadata = {
  title: "NBA player stats",
  alternates: { canonical: "/players" },
  description:
    "Every NBA player this season: games, minutes, points, rebounds, assists, shooting, injury status and the experimental 548 score, a rating from box scores.",
};

// Re-rendered about once a minute from the published data (src/lib/live-data/published.ts).
export const revalidate = 60;

/** The default minimum, so the table opens on rotation players. */
const DEFAULT_MINUTES = 10;

export default async function PlayersPage() {
  const [index, lists, stamp] = await Promise.all([getPlayerIndex(), getTeamInjuryLists(), getLiveState()]);
  const rows = index ? playerTableRows(index, lists) : [];
  const teams = SEASON_TEAMS.map((team) => teamDisplay(team.id))
    .map((team) => ({ id: team.id, code: team.code, name: team.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <Ticker />
      <PageStamp generatedAt={stamp.generatedAt} />
    <main className="pp-container pb-4 pt-7 sm:pt-11">
      <SectionHeading
        as="h1"
        kicker={index ? index.seasonLabel : "Players"}
        title="Players"
        dek={
          index ? (
            <span className="block max-w-[64ch]">
              Every player this season, per game played, from {index.storedGames.toLocaleString("en-US")} stored box
              scores{index.throughEtDate ? ` through ${formatLongDay(index.throughEtDate)}` : ""}. Search, filter by
              minutes or team, and sort by any column. Status is his team&apos;s injury list for its next
              game; the <Link href="/injuries" className="pp-link">injuries page</Link> has every list.
            </span>
          ) : undefined
        }
      />
      {index ? (
        <>
          <p className="notice-quiet mt-5">
            {index.scoreLabel} It cannot see most defence and is not a reliable ranking of players.{" "}
            <Link href="/how-it-works#score" className="pp-link">About the 548 score</Link>
          </p>
          <div className="mt-6">
            <PlayersTable
              rows={rows}
              caption="Every player's season averages, shooting, 548 score and injury status."
              initialMinutes={DEFAULT_MINUTES}
              teams={teams}
            />
          </div>
          <p className="mt-4 max-w-[64ch] text-13 leading-5 text-ink-2">
            Box scores come from ESPN&apos;s public feeds; games, starts and averages count games he played. A player
            traded during the season is listed under his latest team with all his games; team pages count only his
            games for that team.
          </p>
        </>
      ) : (
        <div className="mt-8">
          <p className="notice-quiet">
            Player stats are not published yet. They appear here once 548 publishes them from the
            season&apos;s box scores.
          </p>
          <p className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-14">
            <Link className="pp-link" href="/teams">All teams</Link>
            <Link className="pp-link" href="/injuries">Injuries</Link>
          </p>
        </div>
      )}
    </main>
    </>
  );
}
