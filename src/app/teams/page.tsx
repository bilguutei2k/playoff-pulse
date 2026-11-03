import type { Metadata } from "next";
import Link from "next/link";
import { heatClass } from "@/components/live/heat";
import { SectionHeading } from "@/components/live/SectionHeading";
import { TeamLogo } from "@/components/live/TeamLogo";
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
    <main className="pp-container py-8 sm:py-10">
      <SectionHeading
        as="h1"
        kicker={liveState.seasonLabel}
        title="Teams"
        dek="Every team's record, its 548 rating (points per game better or worse than an average team) and its chance to win the title. Pick a team for its schedule, odds and injuries."
      />
      {CONFERENCES.map((conference) => {
        const teams = rows
          .filter((row) => row.conference === conference)
          .sort((a, b) => a.name.localeCompare(b.name));
        return (
          <section key={conference} aria-labelledby={`conference-${conference}`} className="mt-10">
            <h2 id={`conference-${conference}`} className="kicker border-b border-line pb-2">
              {conference}ern Conference
            </h2>
            <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
              {teams.map((team) => (
                <li key={team.teamId}>
                  <Link
                    href={`/teams/${team.slug}`}
                    className="group flex h-full items-center gap-4 rounded-[var(--radius-card)] border border-line bg-panel px-4 py-3.5 transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[0_10px_30px_-18px_rgba(18,20,23,0.35)]"
                  >
                    <TeamLogo teamId={team.teamId} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-ink group-hover:underline group-hover:decoration-pulse group-hover:underline-offset-4">
                        {team.name}
                      </span>
                      <span className="num mt-1 block text-[12px] text-ink-3">
                        {formatRecord(team.wins, team.losses)} · rating {formatRating(team.rating)} (#{team.ratingRank})
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className="kicker text-[9.5px]">Title</span>
                      <span className={`heat ${heatClass(team.champion)} min-w-[2.75rem] px-1.5 py-0.5 text-[12.5px]`}>
                        {formatChance(team.champion)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
