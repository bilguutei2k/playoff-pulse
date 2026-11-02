import Link from "next/link";
import { heatClass } from "@/components/live/heat";
import { SectionHeading } from "@/components/live/SectionHeading";
import { TeamLogo } from "@/components/live/TeamLogo";
import { titleOddsChange } from "@/lib/season/history";
import type { LiveState, RecordSummary } from "@/lib/season/types";
import { formatChance, formatPointChange } from "@/lib/utils/format";
import { formatShortDay } from "@/lib/utils/dates";
import { formatRecord, teamDisplay, teamHref } from "@/lib/view/teams";
import { SMALL_SAMPLE_LABEL } from "@/lib/view/record";

/** The eight likeliest champions, with the move since the last day the odds changed. */
export function TitleRace({ state }: { state: LiveState }) {
  const change = titleOddsChange(state.history);
  const top = [...state.forecast.teams].sort((a, b) => b.champion - a.champion).slice(0, 8);
  return (
    <section aria-labelledby="title-race" className="panel p-5 sm:p-6">
      <SectionHeading
        id="title-race"
        kicker="Season forecast"
        title="Title race"
        dek={`Chance to win the championship, from ${state.forecast.iterations.toLocaleString("en-US")} simulations of the rest of the season.`}
        href="/odds"
        linkLabel="All odds"
      />
      <table className="mt-5 w-full text-[14px]">
        <caption className="sr-only">Title odds, top eight teams</caption>
        <thead>
          <tr className="border-b border-line-strong text-left">
            <th scope="col" className="kicker pb-2 font-medium">Team</th>
            <th scope="col" className="kicker pb-2 text-right font-medium">Title</th>
            <th scope="col" className="kicker hidden pb-2 text-right font-medium min-[420px]:table-cell">
              {change ? `Since ${formatShortDay(change.since)}` : "Change"}
            </th>
          </tr>
        </thead>
        <tbody>
          {top.map((team) => {
            const display = teamDisplay(team.teamId);
            const delta = change?.change[team.teamId];
            return (
              <tr key={team.teamId} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 text-left font-normal">
                  <Link href={teamHref(team.teamId)} className="flex items-center gap-2.5 hover:underline hover:decoration-pulse hover:underline-offset-4">
                    <TeamLogo teamId={team.teamId} size={22} />
                    <span className="font-medium text-ink">{display.shortName}</span>
                    <span className="num text-[12px] text-ink-3">{formatRecord(team.wins, team.losses)}</span>
                  </Link>
                </th>
                <td className="py-2 text-right">
                  <span className={`heat ${heatClass(team.champion)}`}>{formatChance(team.champion)}</span>
                </td>
                <td className="num hidden py-2 text-right text-[13px] text-ink-2 min-[420px]:table-cell">
                  {delta === undefined ? "–" : formatPointChange(delta)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {change ? (
        <p className="mt-3 text-[12px] text-ink-3">Change in percentage points.</p>
      ) : null}
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="kicker">{label}</dt>
      <dd className="figure mt-1.5 text-[26px] font-semibold text-ink">{value}</dd>
      {note ? <dd className="mt-1 text-[12px] text-ink-3">{note}</dd> : null}
    </div>
  );
}

/** The published model's record at a glance, with its small-sample label. */
export function RecordGlance({ record }: { record: RecordSummary }) {
  return (
    <section aria-labelledby="record-glance" className="panel p-5 sm:p-6">
      <SectionHeading
        id="record-glance"
        kicker="Track record"
        title="Every forecast, scored"
        dek={
          <>
            Each game is sealed before tip and scored after the final. Model{" "}
            <span className="num whitespace-nowrap text-[14px]">{record.modelVersion}</span>.
          </>
        }
        href="/record"
        linkLabel="Full record"
      />
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Stat label="Scored" value={String(record.scored)} note={`${record.pending} pending`} />
        <Stat
          label="Brier"
          value={record.brier === null ? "–" : record.brier.toFixed(3)}
          note={record.brier === null ? "After the first final" : "Lower is better"}
        />
        <Stat label="Missed" value={String(record.missed)} note="Tipped unsealed" />
        <Stat
          label="No final seal"
          value={record.noFinalSeal === null ? "–" : String(record.noFinalSeal)}
          note={record.noFinalSeal === null ? "Seals once a game" : "Scored on morning seal"}
        />
      </dl>
      {record.smallSample ? (
        <p className="notice-quiet mt-5 text-[13px]">{SMALL_SAMPLE_LABEL(record.scored)}</p>
      ) : null}
    </section>
  );
}
