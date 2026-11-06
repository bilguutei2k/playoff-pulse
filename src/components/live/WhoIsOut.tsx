import Link from "next/link";
import { AbsenceRows } from "@/components/live/AbsenceList";
import { TeamLogo } from "@/components/live/TeamLogo";
import { formatReportTime } from "@/lib/utils/dates";
import type { TeamAbsences } from "@/lib/view/odds";
import { teamColor, teamDisplay, teamHref } from "@/lib/view/teams";

const SHOWN = 15;

function points(value: number): string {
  return value >= 0.05 ? `−${value.toFixed(1)}` : "0.0";
}

/** One team: name, a bar in its color, the points; opens to the players behind them. */
function TeamRow({ team, max }: { team: TeamAbsences; max: number }) {
  const display = teamDisplay(team.teamId);
  const width = team.points >= 0.05 ? Math.max(1, (team.points / max) * 100) : 0;
  return (
    <li>
      <details className="group/row">
        <summary className="grid min-h-8 cursor-pointer list-none grid-cols-[minmax(0,130px)_minmax(0,1fr)_52px] items-center gap-3 py-[5px] hover:bg-wash [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[14px]">
            <TeamLogo teamId={team.teamId} size={18} />
            <span className="truncate group-open/row:font-bold">{display.shortName}</span>
          </span>
          <span aria-hidden className="block h-2.5" style={{ width: `${width}%`, background: teamColor(team.teamId) }} />
          <span className="num flex items-center justify-end gap-1.5 text-[14px]">
            {points(team.points)}
            <span aria-hidden className="inline-block text-[11px] text-ink-2 transition-transform group-open/row:rotate-90 motion-reduce:transition-none">▸</span>
          </span>
        </summary>
        <div className="mb-3 ml-[26px] border-l-2 border-line pl-3">
          {team.players.length > 0 ? (
            <AbsenceRows rows={team.players} />
          ) : (
            <p className="py-2 text-[13px] text-ink-2">The model counts no {display.shortName} player as out.</p>
          )}
          <p className="pb-1 text-[13px]">
            <Link href={teamHref(team.teamId)} className="pp-link">
              {display.shortName} team page
            </Link>
          </p>
        </div>
      </details>
    </li>
  );
}

/**
 * Who the season simulation counts as out: every team's points lost in its next game,
 * as bars in team colors, the fifteen largest first. Each row opens to its players.
 */
export function WhoIsOut({
  teams,
  reportAt,
  slateEtDate,
}: {
  teams: TeamAbsences[];
  reportAt: string | null;
  /** The published slate, so a report from another day shows its date. */
  slateEtDate?: string;
}) {
  const max = Math.max(0.1, ...teams.map((team) => team.points));
  const top = teams.slice(0, SHOWN);
  const rest = teams.slice(SHOWN);
  return (
    <section aria-labelledby="who-is-out">
      <div className="sh">
        <h2 id="who-is-out">Who is out</h2>
        <span>
          Points lost next game{reportAt ? ` · report ${formatReportTime(reportAt, slateEtDate)}` : ""}
        </span>
      </div>
      {teams.every((team) => team.players.length === 0) ? (
        <p className="notice-quiet">No current absence counts in the model.</p>
      ) : (
        <>
          <ul aria-label="Points each team gives up in its next game to players currently out">
            {top.map((team) => (
              <TeamRow key={team.teamId} team={team} max={max} />
            ))}
          </ul>
          {rest.length > 0 ? (
            <details className="group/more mt-3">
              <summary className="inline-flex h-11 cursor-pointer list-none items-center text-[15px] font-bold hover:underline hover:underline-offset-4 [&::-webkit-details-marker]:hidden">
                <span className="group-open/more:hidden">
                  {rest.length} more {rest.length === 1 ? "team" : "teams"}
                </span>
                <span className="hidden group-open/more:inline">Fewer teams</span>
              </summary>
              <ul aria-label="The other teams">
                {rest.map((team) => (
                  <TeamRow key={team.teamId} team={team} max={max} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
      <p className="mt-4 text-[13px] leading-5 text-ink-2">
        Select a team to see its players. The model counts players listed out or doubtful on the NBA injury report,
        or who missed their team&apos;s last game and are not listed as probable or available; a team that has not
        filed yet keeps only the players who missed its last game. Expected games out come from a return table
        fitted on past seasons, never from reported return dates. A game&apos;s sealed number counts the report in
        use at its seal instead, weighted by status (or, for a team that has not filed yet, these current
        absences); its game page lists those players.
      </p>
    </section>
  );
}
