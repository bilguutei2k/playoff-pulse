import Link from "next/link";
import { AutoRefresh } from "@/components/live/AutoRefresh";
import { DateStrip, dayHref } from "@/components/live/DateStrip";
import { GameCard } from "@/components/live/GameCard";
import { RecordGlance, TitleRace } from "@/components/live/HomePanels";
import { getGameCountsByDate, getLiveState, getSeasonGames } from "@/lib/live-data/published";
import { formatLongDay } from "@/lib/utils/dates";
import type { DayView } from "@/lib/view/day";
import { PROJECTION_WITH_INJURIES_LABEL } from "@/lib/season/projections";
import { basisSummary } from "@/lib/view/injury-report";
import { PROJECTION_LABEL } from "@/lib/view/projection";
import { recordsThrough, teamLines } from "@/lib/view/teams";

const KICKERS = { past: "Results", today: "Today's games", future: "Schedule" } as const;

function summary(view: DayView): string {
  const count = view.games.length;
  const parts = [`${count} ${count === 1 ? "game" : "games"}`];
  const live = view.games.filter((game) => game.status === "in-progress").length;
  const final = view.games.filter((game) => game.status === "final").length;
  if (live > 0) parts.push(`${live} live`);
  if (final > 0 && final < count) parts.push(`${final} final`);
  if (final === count && count > 0) parts.push("all final");
  return parts.join(" · ");
}

function HowToRead({ view }: { view: DayView }) {
  const providers = [...new Set(view.games.flatMap((game) => (game.market ? [game.market.provider] : [])))];
  const provider = providers.length > 0 ? providers.join(" or ") : "DraftKings";
  const items: Array<[string, string]> = [
    ["548", "Our chance of each team winning. Each game is sealed in the morning and again in the hour before tip; the final seal is the one scored."],
    ["Market", `${provider} moneyline via ESPN, vig removed. Shown beside the model for reference, never as advice. (+3) is 548's number minus the market's, in percentage points.`],
    ["#3", "The team's rank in the 548 rating, out of 30."],
    ["Injuries", "Players on the NBA injury report, weighted by status, and the points of margin their team gives up. A card names up to three players listed out, doubtful or questionable, largest first, then how many more, for a team whose absences move the line by a point or more; the game page lists everyone. A team that has not filed its report counts the players who missed its last game. Unknown future injuries, minutes shifting to teammates and matchups are not modeled."],
  ];
  return (
    <section aria-labelledby="how-to-read" className="mt-10 border-t border-line pt-6">
      <h2 id="how-to-read" className="kicker">How to read a card</h2>
      <dl className="mt-3 grid gap-x-10 gap-y-3 text-[13px] leading-5 text-ink-2 md:grid-cols-2">
        {items.map(([term, definition]) => (
          <div key={term} className="flex gap-3">
            <dt className="num w-16 shrink-0 font-semibold text-ink">{term}</dt>
            <dd>{definition}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[13px]">
        <Link href="/how-it-works" className="pp-link">How the forecast works</Link>
      </p>
    </section>
  );
}

function nearestGameDay(counts: Record<string, number>, from: string, direction: 1 | -1): string | null {
  const days = Object.keys(counts).filter((day) => counts[day] > 0).sort();
  if (direction === 1) return days.find((day) => day > from) ?? null;
  return [...days].reverse().find((day) => day < from) ?? null;
}

export async function DayPage({ view, home }: { view: DayView; home: boolean }) {
  const [liveState, games, counts] = await Promise.all([getLiveState(), getSeasonGames(), getGameCountsByDate()]);
  const known = Object.keys(counts).sort();
  const first = known[0] && known[0] < view.etDate ? known[0] : view.etDate;
  const last = known.at(-1) && known.at(-1)! > view.etDate ? known.at(-1)! : view.etDate;
  // Past days show records through that date; ranks then are not published.
  const lines = view.kind === "past" ? recordsThrough(games, view.etDate) : teamLines(liveState);
  const today = view.todayEtDate;
  const anyLive = view.games.some((game) => game.status === "in-progress");
  const forecasts = view.games.flatMap((game) => (game.forecast ? [game.forecast] : []));
  const noneSealed =
    view.kind === "today" &&
    view.games.length > 0 &&
    forecasts.length > 0 &&
    forecasts.every((forecast) => forecast.source === "provisional");
  const beforeInjuries = forecasts.filter((forecast) => forecast.absencePoints === null);
  const projections = view.games.flatMap((game) => (game.projection ? [game.projection] : []));
  const withInjuries = projections.filter((projection) => projection.withInjuries);
  const ratingsOnly = projections.length - withInjuries.length;
  const nextDay = nearestGameDay(counts, view.etDate, 1);
  const previousDay = nearestGameDay(counts, view.etDate, -1);

  return (
    <>
      <div className="border-b border-line bg-panel">
        <div className="pp-container py-2.5">
          <DateStrip selected={view.etDate} today={today} counts={counts} first={first} last={last} />
        </div>
      </div>
      <main className="pp-container py-8 sm:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kicker">{KICKERS[view.kind]}</p>
            <h1 className="headline mt-1 text-[32px] sm:text-[44px]">{formatLongDay(view.etDate)}</h1>
            {view.games.length > 0 ? (
              <p className="num mt-2 text-[13px] text-ink-2">{summary(view)} · times ET</p>
            ) : null}
          </div>
          {view.etDate !== today ? (
            <Link href="/" className="pp-link text-[14px]">Back to today</Link>
          ) : null}
        </header>

        <div className="mt-6 space-y-3 empty:hidden">
          {view.kind === "today" && view.stale ? (
            <p role="alert" className="notice">
              The forecast job last published {Math.round(view.stateAgeHours)} hours ago, so ratings
              and season odds may be out of date. Sealed forecasts still show.
            </p>
          ) : null}
          {!view.scoresAvailable ? (
            <p role="status" className="notice">
              Live scores could not be loaded just now. Sealed forecasts still show, and this page
              keeps retrying.
            </p>
          ) : null}
          {noneSealed ? (
            <p className="notice-quiet">
              Today&apos;s forecasts are not sealed yet. Until the morning run seals them, each card
              shows a provisional number from the latest ratings and published absences. Provisional
              numbers are labeled and never scored.
            </p>
          ) : null}
          {view.kind === "future" && withInjuries.length > 0 ? (
            <p className="notice-quiet">
              {PROJECTION_WITH_INJURIES_LABEL}{" "}
              {basisSummary(withInjuries.map((projection) => projection.basis), view.etDate)} Projections are never
              compared with the market. Every team&apos;s list is on the{" "}
              <Link href="/injuries" className="pp-link">injury report</Link>.
            </p>
          ) : null}
          {view.kind === "future" && ratingsOnly > 0 ? (
            <p className="notice-quiet">
              {PROJECTION_LABEL} Projections with the injury term cover the next seven days. Projections are never
              scored or compared with the market.
            </p>
          ) : null}
          {beforeInjuries.length > 0 ? (
            <p className="notice-quiet">
              {beforeInjuries.length === forecasts.length ? "These numbers" : "Some numbers on this day"} were
              sealed by {beforeInjuries[0].modelVersion}, which does not account for injuries.
            </p>
          ) : null}
        </div>

        {view.games.length === 0 ? (
          <div className="panel mt-8 px-6 py-10 text-center">
            <p className="headline text-[22px]">No NBA games on {formatLongDay(view.etDate)}</p>
            <p className="mx-auto mt-2 max-w-md text-[15px] text-ink-2">
              {nextDay
                ? "Forecasts are sealed on the morning of each game day."
                : "The schedule has no later games this season."}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3 text-[14px]">
              {previousDay ? (
                <Link className="pp-button" href={dayHref(previousDay, today)}>
                  Previous games: {formatLongDay(previousDay)}
                </Link>
              ) : null}
              {nextDay ? (
                <Link className="pp-button pp-button-primary" href={dayHref(nextDay, today)}>
                  Next games: {formatLongDay(nextDay)}
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <ul className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2" aria-label="Games">
            {view.games.map((game) => (
              <li key={game.id} className="flex min-w-0">
                <div className="flex w-full min-w-0">
                  <GameCard
                    game={game}
                    lines={lines}
                    modelVersion={view.modelVersion}
                    modelNote={beforeInjuries.length !== forecasts.length}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        {home ? (
          <div className="mt-14 grid gap-6 lg:grid-cols-2">
            <TitleRace state={liveState} />
            <RecordGlance record={liveState.record} generatedAt={liveState.generatedAt} />
          </div>
        ) : null}

        {view.games.length > 0 ? <HowToRead view={view} /> : null}
      </main>
      {view.kind === "today" ? <AutoRefresh live={anyLive} /> : null}
    </>
  );
}
