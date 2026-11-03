import Link from "next/link";
import { SectionHeading } from "@/components/live/SectionHeading";
import { TeamLogo } from "@/components/live/TeamLogo";
import type { PublishedAbsence } from "@/lib/season/types";
import { formatReportTime } from "@/lib/utils/dates";
import { driverStatus } from "@/lib/utils/injuries";
import { teamDisplay, teamHref } from "@/lib/view/teams";

function gamesText(value: number, more = false): string {
  const rounded = Math.round(value);
  return `${rounded} ${more ? "more " : ""}${rounded === 1 ? "game" : "games"}`;
}

/** "−1.3 pts", or "0.0 pts" for a replacement-level absence. */
export function lostPoints(points: number): string {
  return points >= 0.05 ? `−${points.toFixed(1)} pts` : "0.0 pts";
}

/** "Out, missed 2 games" or, for a player not on the report, "Missed the last 2 games". */
function statusText(row: PublishedAbsence): string {
  if (row.status === null) {
    return row.gamesMissed > 1 ? `Not listed, missed the last ${row.gamesMissed} games` : "Not listed, missed the last game";
  }
  return row.gamesMissed > 0 ? `${driverStatus(row)}, missed ${gamesText(row.gamesMissed)}` : driverStatus(row);
}

/** One team's current absences as rows: name, status, points and expected games out. */
export function AbsenceRows({ rows }: { rows: PublishedAbsence[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((row) => (
        <li key={row.athleteId} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
          <span className="min-w-0">
            <span className="font-medium text-ink">{row.name}</span>{" "}
            <span className="block text-[12px] text-ink-3">{statusText(row)}</span>
          </span>
          <span className="num shrink-0 text-right text-[12px] text-ink-2">
            {lostPoints(row.points)}
            <span className="block text-ink-3">about {gamesText(row.expectedGames, true)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Who the season simulation currently counts as out, team by team. */
export function AbsenceList({
  absences,
  absencePoints,
  reportAt,
  slateEtDate,
}: {
  absences: PublishedAbsence[];
  absencePoints: Record<string, number>;
  reportAt: string | null;
  /** The published slate, so a report from another day shows its date. */
  slateEtDate?: string;
}) {
  const teams = [...new Set(absences.map((row) => row.teamId))].sort(
    (a, b) => (absencePoints[b] ?? 0) - (absencePoints[a] ?? 0),
  );
  return (
    <section aria-labelledby="absences-title">
      <SectionHeading
        id="absences-title"
        kicker="Injuries in the model"
        title="Who the model counts as out"
        dek={
          <>
            Players listed out or doubtful on the NBA injury report
            {reportAt ? ` (latest ${formatReportTime(reportAt, slateEtDate)})` : ""}, or who missed their
            team&apos;s last game and are not listed as probable or available. A team that has not filed yet
            keeps only the players who missed its last game. Expected games out come from a survival table fitted
            on past seasons, never from reported return dates. A game&apos;s sealed number counts the report in use
            at its seal instead, weighted by status; its game page lists those players.
          </>
        }
      />
      {teams.length === 0 ? (
        <p className="notice-quiet mt-5">No current absence counts in the model.</p>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {teams.map((teamId) => {
            const rows = absences.filter((row) => row.teamId === teamId).sort((a, b) => b.points - a.points);
            const team = teamDisplay(teamId);
            return (
              <div key={teamId} className="panel px-4 pb-2 pt-3">
                <p className="flex items-center justify-between gap-3 border-b border-line pb-2">
                  <Link href={teamHref(teamId)} className="flex items-center gap-2 font-semibold text-ink hover:underline hover:decoration-pulse hover:underline-offset-4">
                    <TeamLogo teamId={teamId} size={20} />
                    {team.shortName}
                  </Link>
                  <span className="num text-[12px] text-ink-2">
                    next game {lostPoints(absencePoints[teamId] ?? 0)}
                  </span>
                </p>
                <AbsenceRows rows={rows} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
