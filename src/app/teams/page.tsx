import type { Metadata } from "next";
import Link from "next/link";
import { TeamLogo } from "@/components/live/TeamLogo";
import { Ticker } from "@/components/live/Ticker";
import { getLiveState, getSeasonGames } from "@/lib/live-data/published";
import type { Conference } from "@/lib/season/types";
import { formatChance } from "@/lib/utils/format";
import { formatRating, oddsRows } from "@/lib/view/odds";
import { formatRecord } from "@/lib/view/teams";

export const metadata: Metadata = {
  title: "Teams",
  description: "All 30 NBA teams with their record, 548 rating and title odds. Each links to a team page with its schedule and forecasts.",
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
      <main className="pp-container pb-4 pt-7 sm:pt-11">
        <header className="mb-12 sm:mb-[60px]">
          <h1 className="headline text-[32px] sm:text-[46px]">Teams</h1>
          <p className="mt-2.5 max-w-2xl text-[15px] text-ink-2">
            {liveState.seasonLabel}. Every team&apos;s record, its 548 rating (points per game better or worse than an
            average team, with its rank) and its chance to win the title. Pick a team for its schedule, odds and injuries.
          </p>
        </header>
        <div className="grid items-start gap-x-[72px] gap-y-14 lg:grid-cols-2">
          {CONFERENCES.map((conference) => {
            const teams = rows
              .filter((row) => row.conference === conference)
              .sort((a, b) => a.name.localeCompare(b.name));
            return (
              <section key={conference} aria-labelledby={`conference-${conference}`}>
                <div className="sh mb-0">
                  <h2 id={`conference-${conference}`}>{conference}ern Conference</h2>
                  <span className="hidden sm:inline">Title</span>
                </div>
                <ul>
                  {teams.map((team) => (
                    <li key={team.teamId} className="border-b border-line">
                      <Link
                        href={`/teams/${team.slug}`}
                        className="group grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3.5 py-3 hover:bg-wash"
                      >
                        <TeamLogo teamId={team.teamId} size={32} />
                        <span className="min-w-0">
                          <span className="block text-[16px] font-bold leading-tight group-hover:underline group-hover:underline-offset-4">
                            {team.name}
                          </span>
                          <span className="num mt-0.5 block text-[13px] text-ink-2">
                            {formatRecord(team.wins, team.losses)} · rating {formatRating(team.rating)} (#{team.ratingRank})
                          </span>
                        </span>
                        <span className={`num text-right text-[15px] ${team.champion >= 0.5 ? "font-bold" : ""}`}>
                          <span className="sr-only">Title chance </span>
                          {formatChance(team.champion)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        <p className="mt-6 text-[13px] text-ink-2">
          Title odds from {liveState.forecast.iterations.toLocaleString("en-US")} simulations. No skill is claimed for
          title odds. <Link href="/odds" className="pp-link">Every team&apos;s odds</Link>
        </p>
      </main>
    </>
  );
}
