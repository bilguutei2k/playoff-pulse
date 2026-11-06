import Link from "next/link";
import { TeamLogo } from "@/components/live/TeamLogo";
import { titleOddsChange } from "@/lib/season/history";
import type { LiveState, RecordSummary } from "@/lib/season/types";
import { formatChance, formatPointChange } from "@/lib/utils/format";
import { formatShortDay } from "@/lib/utils/dates";
import { CALIBRATION_MIN_GAMES, SMALL_SAMPLE_GAMES } from "@/lib/view/record";
import { teamColor, teamDisplay, teamHref } from "@/lib/view/teams";

/**
 * The likeliest champions as bars in team colors, with the move since the last day the
 * odds changed, in percentage points. Bars are scaled to the leader.
 */
export function TitleRace({ state, count = 8, headingLevel = 2 }: { state: LiveState; count?: number; headingLevel?: 2 | 3 }) {
  const change = titleOddsChange(state.history);
  const top = [...state.forecast.teams].sort((a, b) => b.champion - a.champion).slice(0, count);
  const max = Math.max(0.0001, top[0]?.champion ?? 0);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby="title-race">
      <div className="sh">
        <Heading id="title-race">Title race</Heading>
        <Link href="/odds">All odds</Link>
      </div>
      <table className="w-full text-[14px]">
        <caption className="sr-only">
          Chance to win the championship, top {count} teams{change ? `, with the change since ${formatShortDay(change.since)} in percentage points` : ""}
        </caption>
        <thead>
          <tr className="text-[13px] text-ink-2">
            <th scope="col" className="pb-2 text-left font-normal">
              <span className="sr-only">Team</span>
            </th>
            <th scope="col" className="w-full pb-2">
              <span className="sr-only">Bar</span>
            </th>
            <th scope="col" className="pb-2 pl-2.5 text-right font-normal">Title</th>
            <th scope="col" className="pb-2 pl-2.5 text-right font-normal" title={change ? `Since ${formatShortDay(change.since)}, percentage points` : undefined}>
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {top.map((team) => {
            const display = teamDisplay(team.teamId);
            const delta = change?.change[team.teamId];
            return (
              <tr key={team.teamId}>
                <th scope="row" className="py-1.5 pr-2.5 text-left font-normal">
                  <Link href={teamHref(team.teamId)} className="flex items-center gap-2 whitespace-nowrap hover:underline hover:underline-offset-4">
                    <TeamLogo teamId={team.teamId} size={18} />
                    {display.shortName}
                  </Link>
                </th>
                <td className="py-1.5" aria-hidden>
                  <span
                    className="block h-2.5"
                    style={{ width: `${Math.max(1, (team.champion / max) * 100)}%`, background: teamColor(team.teamId) }}
                  />
                </td>
                <td className="num py-1.5 pl-2.5 text-right font-bold">{formatChance(team.champion)}</td>
                <td className="num whitespace-nowrap py-1.5 pl-2.5 text-right text-[13px] text-ink-2">
                  {delta === undefined ? "–" : formatPointChange(delta)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2.5 text-[13px] text-ink-2">
        {state.forecast.iterations.toLocaleString("en-US")} simulations. No skill claimed for title odds.
        {change ? ` Change since ${formatShortDay(change.since)}, in points.` : ""}
      </p>
    </section>
  );
}

/** The published model's record at a glance: progress toward 500 scored games. */
export function RecordGlance({ record }: { record: RecordSummary }) {
  const share = (value: number) => `${Math.min(100, (value / SMALL_SAMPLE_GAMES) * 100)}%`;
  return (
    <section aria-labelledby="record-glance">
      <div className="sh">
        <h2 id="record-glance">Track record</h2>
        <Link href="/record">Full record</Link>
      </div>
      <p className="flex items-baseline gap-2.5">
        <span className="figure text-[60px]">{record.scored}</span>
        <span className="text-ink-2">of {SMALL_SAMPLE_GAMES} games scored</span>
      </p>
      <div
        className="bar mb-1.5 mt-4"
        role="img"
        aria-label={`${record.scored} of ${SMALL_SAMPLE_GAMES} games scored; calibration opens at ${CALIBRATION_MIN_GAMES}`}
      >
        <i style={{ width: share(record.scored) }} />
        <b aria-hidden className="absolute -bottom-[5px] -top-[5px] w-0.5 bg-ink" style={{ left: share(CALIBRATION_MIN_GAMES) }} />
      </div>
      <div aria-hidden className="relative h-5 text-[13px] text-ink-2">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: share(CALIBRATION_MIN_GAMES) }}>
          {CALIBRATION_MIN_GAMES} calibration
        </span>
        <span className="absolute right-0">{SMALL_SAMPLE_GAMES}</span>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-4 text-[13px]">
        <div>
          <dt className="text-ink-2">Brier</dt>
          <dd className="num mt-0.5 text-[17px] font-bold">{record.brier === null ? "–" : record.brier.toFixed(3)}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Missed</dt>
          <dd className="num mt-0.5 text-[17px] font-bold">{record.missed}</dd>
        </div>
        <div>
          <dt className="text-ink-2">No final seal</dt>
          <dd className="num mt-0.5 text-[17px] font-bold">{record.noFinalSeal === null ? "–" : record.noFinalSeal}</dd>
        </div>
      </dl>
      {record.smallSample ? (
        <p className="mt-3 text-[13px]">
          <b>Small sample.</b> <span className="text-ink-2">Below {SMALL_SAMPLE_GAMES} games, results say little about skill.</span>
        </p>
      ) : null}
    </section>
  );
}
