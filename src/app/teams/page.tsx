import type { Metadata } from "next";
import Link from "next/link";
import { PageStamp } from "@/components/live/FreshnessGuard";
import { TeamLogo } from "@/components/live/TeamLogo";
import { Ticker } from "@/components/live/Ticker";
import { getLiveState, getSeasonGames } from "@/lib/live-data/published";
import type { Conference } from "@/lib/season/types";
import { formatChance } from "@/lib/utils/format";
import { formatRating, oddsRows } from "@/lib/view/odds";
import { conferenceOrder, formatRecord, ordinal } from "@/lib/view/teams";

export const metadata: Metadata = {
  title: "Teams",
  description:
    "All 30 NBA teams in conference order with their record, 548 rating, playoff and title odds. Each links to a team page with its schedule and forecasts.",
  alternates: { canonical: "/teams" },
};

const CONFERENCES: Conference[] = ["East", "West"];

// Re-rendered about once a minute from main's published data (src/lib/live-data/published.ts).
export const revalidate = 60;

export default async function TeamsPage() {
  const [liveState, seasonGames] = await Promise.all([getLiveState(), getSeasonGames()]);
  const rows = oddsRows(liveState, seasonGames);
  return (
    <>
      <Ticker />
      <PageStamp generatedAt={liveState.generatedAt} />
      <main className="pp-container pb-4 pt-7 sm:pt-11">
        <header className="mb-12 sm:mb-[60px]">
          <h1 className="headline text-32 sm:text-46">Teams</h1>
          <p className="mt-2.5 max-w-2xl text-15 text-ink-2">
            {liveState.seasonLabel}. Each conference in order of record, with every team&apos;s 548 rating (points per
            game better or worse than an average team, with its rank) and its chances to make the playoffs and win the
            title. Pick a team for its schedule, odds and injuries.
          </p>
        </header>
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-[72px] gap-y-14 lg:grid-cols-2">
          {CONFERENCES.map((conference) => {
            const order = conferenceOrder(liveState.forecast.teams, conference);
            const teams = order.map((team) => rows.find((row) => row.teamId === team.teamId)!);
            return (
              <section key={conference} aria-labelledby={`conference-${conference}`} className="min-w-0">
                <div className="sh mb-0">
                  <h2 id={`conference-${conference}`}>{conference}ern Conference</h2>
                </div>
                <div aria-hidden className="ti-row border-b border-ink pb-2 pt-1 text-13 text-ink-2">
                  <span className="col-span-3">By record</span>
                  <span className="text-right">Playoffs</span>
                  <span className="text-right">Title</span>
                </div>
                <ol>
                  {teams.map((team, index) => (
                    <li
                      key={team.teamId}
                      className={`border-b ${index === 5 || index === 9 ? "border-dashed border-ink-2" : "border-line"}`}
                    >
                      <Link href={`/teams/${team.slug}`} className="group ti-row py-3 hover:bg-wash">
                        <span className="num text-right text-15 font-bold text-ink-2">
                          <span className="sr-only">{ordinal(index + 1)} in the {conference}: </span>
                          {index + 1}
                        </span>
                        <TeamLogo teamId={team.teamId} size={28} />
                        <span className="min-w-0">
                          <span className="block text-[15px] font-bold leading-tight group-hover:underline group-hover:underline-offset-4 min-[360px]:text-[16px]">
                            {team.name}
                          </span>
                          <span className="num mt-0.5 block text-13 text-ink-2">
                            {formatRecord(team.wins, team.losses)} · <span className="hidden sm:inline">rating </span>
                            {formatRating(team.rating)} (#{team.ratingRank})
                          </span>
                        </span>
                        <span className={`num text-right text-15 ${team.makePlayoffs >= 0.5 ? "font-bold" : ""}`}>
                          <span className="sr-only">, playoff chance </span>
                          {formatChance(team.makePlayoffs)}
                        </span>
                        <span className={`num text-right text-15 ${team.champion >= 0.5 ? "font-bold" : ""}`}>
                          <span className="sr-only">, title chance </span>
                          {formatChance(team.champion)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
        <p className="mt-6 max-w-3xl text-13 text-ink-2">
          Order by record today (win percentage, then wins); the dashed lines fall after sixth and tenth. The NBA&apos;s
          tiebreakers decide seeds in the simulation, so a tied team&apos;s place here can differ from its seed. Playoff
          chance includes winning through the play-in. Odds from {liveState.forecast.iterations.toLocaleString("en-US")}{" "}
          simulations; midseason playoff odds are not claimed to be well calibrated, and no skill is claimed for title
          odds. <Link href="/odds" className="pp-link">Every team&apos;s odds</Link>
        </p>
      </main>
    </>
  );
}
