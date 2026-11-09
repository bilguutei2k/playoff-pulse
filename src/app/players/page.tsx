import type { Metadata } from "next";
import Link from "next/link";
import { PlayersTable } from "@/components/live/PlayersTable";
import { SectionHeading } from "@/components/live/SectionHeading";
import { getPlayerIndex, getTeamInjuryLists } from "@/lib/live-data/published";
import { IMPACT_LABEL } from "@/lib/season/player-stats";
import { SEASON_TEAMS } from "@/lib/season/teams";
import { formatLongDay } from "@/lib/utils/dates";
import { playerTableRows } from "@/lib/view/players";
import { teamDisplay } from "@/lib/view/teams";
import { Ticker } from "@/components/live/Ticker";

export const metadata: Metadata = {
  title: "NBA player stats",
  description:
    "Every NBA player this season: games, minutes, points, rebounds, assists, shooting, injury status and 548's estimate of what his team loses without him.",
};

// Re-rendered about once a minute from the published data (src/lib/live-data/published.ts).
export const revalidate = 60;

/** The default minimum, so the table opens on rotation players. */
const DEFAULT_MINUTES = 10;

export default async function PlayersPage() {
  const [index, lists] = await Promise.all([getPlayerIndex(), getTeamInjuryLists()]);
  const rows = index ? playerTableRows(index, lists) : [];
  const teams = SEASON_TEAMS.map((team) => teamDisplay(team.id))
    .map((team) => ({ id: team.id, code: team.code, name: team.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <Ticker />
    <main className="pp-container pb-4 pt-7 sm:pt-11">
      <SectionHeading
        as="h1"
        kicker={index ? index.seasonLabel : "Players"}
        title="Players"
        dek={
          index ? (
            <>
              Every player this season, per game played, from {index.storedGames.toLocaleString("en-US")} stored box
              scores{index.throughEtDate ? ` through ${formatLongDay(index.throughEtDate)}` : ""}. Search, filter by
              minutes or team, and select a column heading to sort. Status is his team&apos;s injury list for its next
              game; the <Link href="/injuries" className="pp-link">injury report</Link> has every list.
            </>
          ) : undefined
        }
      />
      {index ? (
        <>
          <p className="notice-quiet mt-5">{IMPACT_LABEL} It comes from box scores and is not a ranking of players.</p>
          <div className="mt-6">
            <PlayersTable
              rows={rows}
              caption="Every player's season averages, shooting, 548 impact and injury status."
              initialMinutes={DEFAULT_MINUTES}
              teams={teams}
            />
          </div>
          <p className="mt-4 text-[12.5px] leading-5 text-ink-3">
            Box scores come from ESPN&apos;s public feeds; games, starts and averages count games he played. A player
            traded during the season is listed under his latest team with all his games; team pages count only his
            games for that team.
          </p>
        </>
      ) : (
        <div className="panel mt-8 px-6 py-10 text-center">
          <p className="headline text-[22px]">Player stats are not published yet</p>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-ink-2">
            They appear here once the forecast job publishes them from the season&apos;s box scores.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3 text-[14px]">
            <Link className="pp-button" href="/teams">Teams</Link>
            <Link className="pp-button" href="/injuries">Injury report</Link>
          </div>
        </div>
      )}
    </main>
    </>
  );
}
