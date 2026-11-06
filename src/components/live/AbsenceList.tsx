import { PlayerLink } from "@/components/live/PlayerLink";
import type { PublishedAbsence } from "@/lib/season/types";
import { driverStatus } from "@/lib/utils/injuries";

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
        <li key={row.athleteId} className="flex items-baseline justify-between gap-3 py-2 text-[14px]">
          <span className="min-w-0">
            <PlayerLink athleteId={row.athleteId} name={row.name} className="text-ink" />{" "}
            <span className="block text-[13px] text-ink-2">{statusText(row)}</span>
          </span>
          <span className="num shrink-0 text-right text-[13px]">
            {lostPoints(row.points)}
            <span className="block text-ink-2">about {gamesText(row.expectedGames, true)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
