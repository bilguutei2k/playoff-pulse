import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TeamLogo } from "@/components/live/TeamLogo";
import { UpdatedAgo } from "@/components/live/UpdatedAgo";
import { teamById } from "@/lib/season/teams";
import type { SeasonPhase, TeamForecast } from "@/lib/season/types";
import { formatShortDay, formatStampEt } from "@/lib/utils/dates";
import { formatChance, formatPointChange } from "@/lib/utils/format";

const SHOWN = 10;

export function TitleOddsLeaderboard({
  teams,
  phase,
  generatedAt,
  change,
}: {
  teams: TeamForecast[];
  phase: SeasonPhase;
  generatedAt: string;
  /** Title-odds change by team since `change.since`, or null with nothing to compare. */
  change: { since: string; change: Record<string, number> } | null;
}) {
  const exact = phase !== "regular-season";
  const top = [...teams].sort((a, b) => b.champion - a.champion).slice(0, SHOWN);
  const leader = top[0]?.champion ?? 0;
  const since = change ? formatShortDay(change.since) : null;
  return (
    <section aria-labelledby="title-odds-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="title-odds-title"
            className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]"
          >
            Title odds
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            The {SHOWN} likeliest champions.{" "}
            <UpdatedAgo iso={generatedAt} stamp={formatStampEt(generatedAt)} />.
          </p>
        </div>
        <Link href="/odds" className="pp-button">
          All 30 teams
          <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-panel-primary)]">
        <table className="pp-table">
          <caption className="sr-only">
            Championship chances for the {SHOWN} likeliest champions
            {since ? `, with the change in percentage points since ${since}` : ""}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-10 num">
                #
              </th>
              <th scope="col">Team</th>
              <th scope="col" className="num hidden sm:table-cell">
                Record
              </th>
              <th scope="col" className="num hidden sm:table-cell">
                Playoffs
              </th>
              <th scope="col" className="num">
                Title
              </th>
              {since ? (
                <th scope="col" className="num">
                  <span className="sm:hidden">Change</span>
                  <span className="hidden sm:inline">Change since {since}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {top.map((row, index) => {
              const team = teamById(row.teamId);
              const delta = change?.change[row.teamId];
              return (
                <tr key={row.teamId}>
                  <td className="num text-[var(--color-text-muted)]">{index + 1}</td>
                  <th scope="row">
                    <span className="flex items-center gap-2.5">
                      <TeamLogo teamId={row.teamId} size={22} />
                      <span className="sm:hidden">{team.shortName}</span>
                      <span className="hidden sm:inline">{team.name}</span>
                    </span>
                  </th>
                  <td className="num hidden sm:table-cell">
                    {row.wins}-{row.losses}
                  </td>
                  <td className="num hidden sm:table-cell">
                    {formatChance(row.makePlayoffs, { exact })}
                  </td>
                  <td className="num">
                    <span className="flex items-center justify-end gap-3">
                      <span
                        aria-hidden
                        className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-panel-tertiary)] md:block"
                      >
                        <span
                          className="block h-full rounded-full bg-[var(--heat-5)]"
                          style={{ width: `${leader > 0 ? (row.champion / leader) * 100 : 0}%` }}
                        />
                      </span>
                      <span className="w-10 font-semibold text-[var(--color-text-primary)]">
                        {formatChance(row.champion, { exact })}
                      </span>
                    </span>
                  </td>
                  {since ? (
                    <td className="num">
                      {delta === undefined ? "–" : formatPointChange(delta)}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {since ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          Change is in percentage points of title odds since {since}, the last day the odds moved.
        </p>
      ) : null}
    </section>
  );
}
