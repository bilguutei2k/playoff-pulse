import Link from "next/link";
import { TeamLink } from "@/components/live/TeamLink";
import { titleOddsChange } from "@/lib/season/history";
import type { LiveState, RecordSummary } from "@/lib/season/types";
import { formatChance, formatPointChange } from "@/lib/utils/format";
import { formatShortDay } from "@/lib/utils/dates";
import { CALIBRATION_MIN_GAMES, SMALL_SAMPLE_GAMES, gameBrier } from "@/lib/view/record";
import type { FavoriteSummary } from "@/lib/view/record-page";
import { teamColor } from "@/lib/view/teams";

/** A coin flip's Brier score, from the record's own formula: what "lower is better" is measured against. */
const COIN_FLIP_BRIER = gameBrier(0.5, true);

const missedSeals = (missed: number) => `${missed} missed ${missed === 1 ? "seal" : "seals"}`;

function titleLeaders(state: LiveState, count: number) {
  return [...state.forecast.teams].sort((a, b) => b.champion - a.champion).slice(0, count);
}

/**
 * The home page's opening lines: what 548 is, the record so far with its small-sample
 * label and missed seals, and where to read more. Numbers are the record's (the same
 * favorite count as /record); descriptive, never a claim of skill.
 */
export function Standfirst({ record, favorites }: { record: RecordSummary; favorites: FavoriteSummary | null }) {
  return (
    <section aria-label="About 548" className="max-w-[560px]">
      <p className="text-[17px] leading-[1.45] sm:text-[19px]">
        <b>548 puts a win probability on every NBA game.</b> Each one is sealed before tip and scored after the final, in
        public.
      </p>
      <p className="mt-3 text-[14px] leading-[1.5]">
        {favorites && favorites.decided > 0 ? (
          <span className="block">
            <b>
              Favorites won {favorites.won} of {favorites.decided}
            </b>
            <span className="text-ink-2">, with 548 expecting {favorites.expected.toFixed(1)}.</span>
          </span>
        ) : (
          <span className="block text-ink-2">The record starts with the first final.</span>
        )}
        <span className="block text-ink-2">
          {record.smallSample ? (
            <>
              <b className="text-ink">Small sample:</b> {record.scored} of {SMALL_SAMPLE_GAMES} games scored ·{" "}
            </>
          ) : null}
          {missedSeals(record.missed)}
        </span>
      </p>
      <p className="mt-1 flex flex-wrap gap-x-6 text-[14px] font-bold">
        <Link href="/how-it-works" className="inline-flex min-h-11 items-center hover:underline hover:underline-offset-4 sm:min-h-8">
          How it works →
        </Link>
        <Link href="/record" className="inline-flex min-h-11 items-center hover:underline hover:underline-offset-4 sm:min-h-8">
          Track record →
        </Link>
        <Link href="/about" className="inline-flex min-h-11 items-center hover:underline hover:underline-offset-4 sm:min-h-8">
          About 548 →
        </Link>
      </p>
    </section>
  );
}

/**
 * The title race in one line, for screens where the sidebar falls below every card:
 * the likeliest champions (two on a phone, three from 640 px) and a link to all odds.
 */
export function TitleStrip({ state }: { state: LiveState }) {
  const top = titleLeaders(state, 3);
  if (top.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-4 border-y border-line text-[14px]">
      <span className="font-bold">Title race</span>
      {top.map((team, index) => (
        <span key={team.teamId} className={`${index === 2 ? "hidden sm:inline-flex" : "inline-flex"} min-h-11 items-center gap-1.5`}>
          <TeamLink teamId={team.teamId} form="code" logo={16} />
          <span className="num">{formatChance(team.champion)}</span>
        </span>
      ))}
      <Link href="/odds" className="ml-auto inline-flex min-h-11 items-center font-bold hover:underline hover:underline-offset-4">
        All odds →
      </Link>
    </p>
  );
}

/**
 * The likeliest champions as bars in team colors, with the move since the last day the
 * odds changed, in percentage points. Bars are scaled to the leader.
 */
export function TitleRace({ state, count = 8, headingLevel = 2 }: { state: LiveState; count?: number; headingLevel?: 2 | 3 }) {
  const change = titleOddsChange(state.history);
  const top = titleLeaders(state, count);
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
            const delta = change?.change[team.teamId];
            return (
              <tr key={team.teamId}>
                <th scope="row" className="pr-2.5 text-left font-normal">
                  <TeamLink teamId={team.teamId} logo={18} className="min-h-11 whitespace-nowrap py-1 lg:min-h-8" />
                </th>
                <td aria-hidden>
                  <span
                    className="block h-2.5"
                    style={{ width: `${Math.max(1, (team.champion / max) * 100)}%`, background: teamColor(team.teamId) }}
                  />
                </td>
                <td className="num pl-2.5 text-right font-bold">{formatChance(team.champion)}</td>
                <td className="num whitespace-nowrap pl-2.5 text-right text-[13px] text-ink-2">
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

/**
 * The published model's record at a glance: how often the sealed favorite won against
 * how many its chances expected (the same count as /record), the Brier score with what
 * it means, missed seals, and progress toward 500 scored games. Descriptive only.
 */
export function RecordGlance({ record, favorites = null }: { record: RecordSummary; favorites?: FavoriteSummary | null }) {
  const share = (value: number) => `${Math.min(100, (value / SMALL_SAMPLE_GAMES) * 100)}%`;
  return (
    <section aria-labelledby="record-glance">
      <div className="sh">
        <h2 id="record-glance">Track record</h2>
        <Link href="/record">Full record</Link>
      </div>
      {favorites && favorites.decided > 0 ? (
        <>
          <p className="text-[14px] text-ink-2">Favorites won</p>
          <p className="mt-1 flex items-baseline gap-2.5">
            <span className="figure text-[52px]">{favorites.won}</span>
            <span className="text-[17px]">of {favorites.decided}</span>
          </p>
          <p className="mt-1 text-[13px] text-ink-2">548&apos;s sealed chances expected {favorites.expected.toFixed(1)}.</p>
        </>
      ) : (
        <p className="text-[14px] text-ink-2">Favorites won: after the first final.</p>
      )}
      <dl className="mt-5 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 text-[13px]">
        <div>
          <dt className="text-ink-2">Brier score</dt>
          <dd className="num mt-0.5 text-[17px] font-bold">{record.brier === null ? "–" : record.brier.toFixed(3)}</dd>
          <dd className="mt-0.5 text-[12.5px] leading-[1.35] text-ink-2">
            Lower is better. A coin flip scores {COIN_FLIP_BRIER.toFixed(3)}.
          </dd>
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
      <p className="mt-6 flex items-baseline gap-2 text-[13px]">
        <b className="num text-[15px]">{record.scored}</b>
        <span className="text-ink-2">of {SMALL_SAMPLE_GAMES} games scored</span>
      </p>
      <div
        className="bar mb-1.5 mt-2"
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
      {record.smallSample ? (
        <p className="mt-3 text-[13px]">
          <b>Small sample.</b> <span className="text-ink-2">Below {SMALL_SAMPLE_GAMES} games, results say little about skill.</span>
        </p>
      ) : null}
    </section>
  );
}
