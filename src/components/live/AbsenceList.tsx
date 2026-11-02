import { TeamLogo } from "@/components/live/TeamLogo";
import { teamById } from "@/lib/season/teams";
import type { PublishedAbsence } from "@/lib/season/types";
import { formatReportTime } from "@/lib/utils/dates";
import { driverStatus, formatPoints } from "@/lib/utils/injuries";

function gamesText(value: number): string {
  const rounded = Math.round(value);
  return `about ${rounded} ${rounded === 1 ? "game" : "games"}`;
}

/** Who the season simulation currently counts as out, team by team, folded by default. */
export function AbsenceList({
  absences,
  absencePoints,
  reportAt,
}: {
  absences: PublishedAbsence[];
  absencePoints: Record<string, number>;
  reportAt: string | null;
}) {
  const teams = [...new Set(absences.map((row) => row.teamId))].sort(
    (a, b) => (absencePoints[b] ?? 0) - (absencePoints[a] ?? 0),
  );
  return (
    <section aria-labelledby="absences-title" className="flex flex-col gap-4">
      <div>
        <h2
          id="absences-title"
          className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]"
        >
          Who the model counts as out
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">
          Players listed Out or Doubtful{reportAt ? ` on the NBA injury report (latest ${formatReportTime(reportAt)})` : " on the NBA injury report"},
          or who missed their team&apos;s last game and are not listed as probable. Expected games
          out come from a survival table fitted on past seasons, never from reported return dates.
          The season odds above carry these absences for those games, then the team returns to full
          strength.
        </p>
      </div>
      {teams.length === 0 ? (
        <p className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-panel-primary)] p-4 text-sm text-[var(--color-text-muted)]">
          No current absence the model counts.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {teams.map((teamId) => {
            const team = teamById(teamId);
            const rows = absences.filter((row) => row.teamId === teamId);
            return (
              <details
                key={teamId}
                className="group rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-panel-primary)] px-4 py-3"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2 font-medium text-[var(--color-text-primary)]">
                    <TeamLogo teamId={teamId} size={20} />
                    <span className="truncate">{team.name}</span>
                  </span>
                  <span className="tabular shrink-0 text-xs text-[var(--color-text-muted)]">
                    {rows.length} out · gives up {formatPoints(absencePoints[teamId] ?? 0)}
                  </span>
                </summary>
                <ul className="mt-2 grid gap-1 border-t border-[var(--color-border-subtle)] pt-2">
                  {rows.map((row) => (
                    <li key={row.athleteId} className="flex items-baseline justify-between gap-3 text-xs leading-5">
                      <span className="min-w-0">
                        <span className="text-[var(--color-text-primary)]">{row.name}</span>{" "}
                        <span className="text-[var(--color-text-muted)]">
                          ({driverStatus(row)}
                          {row.gamesMissed > 0 ? `, missed ${row.gamesMissed}` : ""})
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-[var(--color-text-muted)]">
                        {formatPoints(row.points)} · {gamesText(row.expectedGames)} more
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
