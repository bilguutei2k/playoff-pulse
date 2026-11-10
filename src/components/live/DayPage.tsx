import Link from "next/link";
import { AutoRefresh } from "@/components/live/AutoRefresh";
import { DateStrip, dayHref } from "@/components/live/DateStrip";
import { FinalsChart, FinalsTable } from "@/components/live/DayFinals";
import { GameCard } from "@/components/live/GameCard";
import { RecordGlance, Standfirst, TitleRace, TitleStrip } from "@/components/live/HomePanels";
import { Tile } from "@/components/live/Tile";
import { loadDayView } from "@/lib/live-data/day-loader";
import { getGameCountsByDate, getLiveState, getSeasonGames, getSeasonLedger } from "@/lib/live-data/published";
import { PROJECTION_WITH_INJURIES_LABEL } from "@/lib/season/projections";
import { formatLongDay, formatShortDay, formatWeekday } from "@/lib/utils/dates";
import type { TileKind } from "@/lib/view/bracket";
import type { DayGame, DayView } from "@/lib/view/day";
import { daySummary, type SentencePart } from "@/lib/view/day-summary";
import { OUT_DEFINITION, TILE_DEFINITION, TILE_GLYPHS } from "@/lib/view/how-to-read";
import { basisSummary } from "@/lib/view/injury-report";
import { PROJECTION_LABEL } from "@/lib/view/projection";
import { versionLedger } from "@/lib/view/record";
import { favoriteSummary } from "@/lib/view/record-page";
import { recordsThrough, teamLines, type TeamLine } from "@/lib/view/teams";

/** How many of the next game day's cards the home page shows under today's. */
const NEXT_DAY_CARDS = 4;

/** "Thursday, Nov 5": the phone's heading. */
function shortLongDay(etDate: string): string {
  const [weekday] = formatLongDay(etDate).split(",");
  return `${weekday}, ${formatShortDay(etDate)}`;
}

function summary(view: DayView): string {
  const count = view.games.length;
  const parts = [`${count} ${count === 1 ? "game" : "games"}`];
  const live = view.games.filter((game) => game.status === "in-progress").length;
  const final = view.games.filter((game) => game.status === "final").length;
  if (live > 0) parts.push(`${live} live`);
  if (final > 0 && final < count) parts.push(`${final} final`);
  if (final === count && count > 0) parts.push("all final");
  parts.push("All times ET");
  return parts.join(" · ");
}

function HowToRead({ view }: { view: DayView }) {
  const providers = [...new Set(view.games.flatMap((game) => (game.market ? [game.market.provider] : [])))];
  const provider = providers.length > 0 ? providers.join(" or ") : "DraftKings";
  const items: Array<[string, string]> = [
    [
      "Team line",
      "Length is the team's chance in 548's number, in its color. The lines join into the tile, which names the side 548 favors.",
    ],
    ["Tile", TILE_DEFINITION],
    [
      "Grey tick",
      `The market: the ${provider} moneyline via ESPN, vig removed. Beside sealed numbers only, for reference, never as advice. On a live game a black tick marks the pregame seal.`,
    ],
    ["Out", OUT_DEFINITION],
  ];
  return (
    <section aria-labelledby="how-to-read" className="mt-16">
      <div className="sh">
        <h2 id="how-to-read">How to read a card</h2>
        <Link href="/how-it-works">How the forecast works</Link>
      </div>
      <dl className="grid gap-x-12 gap-y-3 text-[13px] leading-5 text-ink-2 md:grid-cols-2">
        {items.map(([term, definition]) => (
          <div key={term}>
            <dt className="inline font-bold text-ink">{term}. </dt>
            <dd className="inline">{definition}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Which tile styles the page's cards use, in the key's order. */
function tileKinds(games: readonly DayGame[]): TileKind[] {
  const live = (game: DayGame) => game.status === "in-progress" && game.inGameHomeProbability !== null;
  const kinds: TileKind[] = [];
  if (games.some((game) => game.forecast?.source === "sealed" && !live(game))) kinds.push("sealed");
  if (games.some(live)) kinds.push("live");
  if (games.some((game) => game.projection !== null || game.forecast?.source === "provisional")) kinds.push("dash");
  return kinds;
}

/**
 * The key above the cards: each tile style on the page and what it means, in the same
 * words as "How to read a card" below, so a first visit learns which number is scored
 * and which can change before scrolling past the games.
 */
function TileKey({ kinds }: { kinds: TileKind[] }) {
  if (kinds.length === 0) return null;
  return (
    <p className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] leading-5 text-ink-2">
      {kinds.map((kind) => (
        <span key={kind} className="inline-flex items-center gap-2">
          <span aria-hidden>
            <Tile kind={kind} size="xs" className="!h-[18px] !min-w-[26px] !px-1 !text-[10.5px]">
              %
            </Tile>
          </span>
          <span>
            <b className="font-semibold text-ink">{TILE_GLYPHS[kind].word}:</b> {TILE_GLYPHS[kind].text}
          </span>
        </span>
      ))}
      <Link href="#how-to-read" className="pp-link py-3">
        How to read a card
      </Link>
    </p>
  );
}

function nearestGameDay(counts: Record<string, number>, from: string, direction: 1 | -1): string | null {
  const days = Object.keys(counts).filter((day) => counts[day] > 0).sort();
  if (direction === 1) return days.find((day) => day > from) ?? null;
  return [...days].reverse().find((day) => day < from) ?? null;
}

/**
 * The cards, as many columns as fit while every card keeps at least 340 px (where the
 * longest team names print whole), up to `columns`. Beside the home sidebar that means
 * one column until about 1220 px. Rules: `.cards` in styles/day.css.
 */
function CardGrid({
  games,
  lines,
  modelVersion,
  modelNote,
  columns,
  future = false,
  label,
}: {
  games: DayGame[];
  lines: Record<string, TeamLine>;
  modelVersion: string;
  modelNote: boolean;
  columns: 2 | 3;
  future?: boolean;
  label: string;
}) {
  return (
    <ul aria-label={label} className={`cards ${columns === 3 ? "cards-3" : ""}`}>
      {games.map((game) => (
        <li key={game.id} className="min-w-0">
          <GameCard game={game} lines={lines} modelVersion={modelVersion} modelNote={modelNote} future={future} />
        </li>
      ))}
    </ul>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mb-14 sm:mb-16">
      <div className="sh">
        <h2 id={id}>{title}</h2>
        {note ? <span>{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** The day sentence, with the biggest miss's game and the favorite's team linked. */
function DaySentence({ parts }: { parts: SentencePart[] }) {
  return (
    <p className="mt-4 max-w-[520px] text-[17px] leading-[1.4] sm:mt-5 sm:text-[20px]">
      {parts.map((part, index) =>
        part.href ? (
          <Link key={index} href={part.href} className="underline decoration-line-strong decoration-1 underline-offset-[0.18em] hover:decoration-ink">
            {part.text}
          </Link>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

/** "Wed, Nov 25": a neighbouring day on the empty day's buttons. */
function buttonDay(etDate: string): string {
  return `${formatWeekday(etDate)}, ${formatShortDay(etDate)}`;
}

const gamesCount = (count: number) => `${count} ${count === 1 ? "game" : "games"}`;

export async function DayPage({ view, home }: { view: DayView; home: boolean }) {
  const [liveState, games, counts, ledger] = await Promise.all([
    getLiveState(),
    getSeasonGames(),
    getGameCountsByDate(),
    home ? getSeasonLedger() : Promise.resolve(null),
  ]);
  // The home page's record count: the same favorites as /record, from the season's ledger.
  const favorites = ledger ? favoriteSummary(versionLedger(ledger, liveState.modelVersion).scored) : null;
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
  const modelNote = beforeInjuries.length !== forecasts.length;

  const sums = daySummary(view.games);
  const liveGames = view.games.filter((game) => game.status === "in-progress");
  const upcoming = view.games.filter((game) => game.status === "scheduled");
  const stopped = view.games.filter((game) => game.status === "postponed" || game.status === "canceled");
  const finalsTitle =
    view.kind === "today" ? `Tonight's ${sums.scored.length} ${sums.scored.length === 1 ? "final" : "finals"}` : `${formatLongDay(view.etDate).split(",")[0]}'s ${sums.scored.length} ${sums.scored.length === 1 ? "final" : "finals"}`;

  // The home page previews the next game day, as projections or its seals.
  const next = home && nextDay ? await loadDayView(nextDay) : null;
  const nextGames = next ? next.games.filter((game) => game.status === "scheduled").slice(0, NEXT_DAY_CARDS) : [];

  const upcomingNote =
    view.kind === "future"
      ? "Projections, never scored"
      : upcoming.some((game) => game.forecast?.source === "sealed")
        ? "Sealed before tip, scored after the final"
        : "Not sealed yet";

  return (
    <>
      <DateStrip selected={view.etDate} today={today} counts={counts} first={first} last={last} />
      <main className="pp-container pb-4 pt-7 sm:pt-11">
        <header
          className={`mb-12 grid items-start gap-x-[72px] gap-y-8 sm:mb-[60px] ${
            // The finals chart sits beside the title from 1024 px; the home standfirst from 1280.
            sums.scored.length > 0 ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]" : home ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,560px)]" : ""
          }`}
        >
          <div>
            <p className="text-[15px] text-ink-2">{view.games.length > 0 ? summary(view) : view.kind === "past" ? "Results" : "Schedule"}</p>
            <h1 className="headline mt-2.5 text-32 sm:text-46 xl:text-56">
              <span className="sm:hidden">{shortLongDay(view.etDate)}</span>
              <span className="hidden sm:inline">{formatLongDay(view.etDate)}</span>
            </h1>
            {sums.sentenceParts ? <DaySentence parts={sums.sentenceParts} /> : null}
            {view.etDate !== today ? (
              <p className="mt-4 text-[14px]">
                <Link href="/" className="pp-link py-3">Back to today</Link>
              </p>
            ) : null}
            {home && sums.scored.length > 0 ? (
              <div className="mt-8">
                <Standfirst record={liveState.record} favorites={favorites} />
              </div>
            ) : null}
          </div>
          {sums.scored.length > 0 ? (
            <FinalsChart summary={sums} title={finalsTitle} />
          ) : home ? (
            <div className="xl:border-l xl:border-line xl:pl-10 xl:pt-1">
              <Standfirst record={liveState.record} favorites={favorites} />
            </div>
          ) : null}
          {home ? (
            <div className="lg:hidden">
              <TitleStrip state={liveState} />
            </div>
          ) : null}
        </header>

        <div className="mb-10 space-y-3 empty:hidden">
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

        <div className={`grid items-start gap-x-[72px] gap-y-4 ${home ? "lg:grid-cols-[minmax(0,1fr)_340px]" : ""}`}>
          <div className="min-w-0">
            <TileKey kinds={tileKinds([...view.games, ...nextGames])} />
            {view.games.length === 0 ? (
              <section aria-labelledby="empty-day" className="mb-14">
                <div className="sh">
                  <h2 id="empty-day">No games</h2>
                </div>
                <p className="max-w-md text-[15px] text-ink-2">
                  {nextDay ? "Forecasts are sealed on the morning of each game day." : "The schedule has no later games this season."}
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  {previousDay ? (
                    <Link className="pp-button min-h-11" href={dayHref(previousDay, today)}>
                      <span aria-hidden>←</span> {buttonDay(previousDay)} · {gamesCount(counts[previousDay] ?? 0)}
                    </Link>
                  ) : null}
                  {nextDay ? (
                    <Link className="pp-button pp-button-primary min-h-11" href={dayHref(nextDay, today)}>
                      {buttonDay(nextDay)} · {gamesCount(counts[nextDay] ?? 0)} <span aria-hidden>→</span>
                    </Link>
                  ) : null}
                </div>
              </section>
            ) : null}

            {liveGames.length > 0 ? (
              <Section id="live-games" title="Live" note="Outline tile: live estimate">
                <CardGrid games={liveGames} lines={lines} modelVersion={view.modelVersion} modelNote={modelNote} columns={home ? 2 : 3} label="Live games" />
              </Section>
            ) : null}

            {upcoming.length > 0 ? (
              <Section id="upcoming-games" title={view.kind === "future" ? "Games" : view.kind === "today" ? "Still to tip" : "Not played"} note={upcomingNote}>
                <CardGrid games={upcoming} lines={lines} modelVersion={view.modelVersion} modelNote={modelNote} columns={home ? 2 : 3} label="Games still to tip" />
              </Section>
            ) : null}

            {sums.finals.length > 0 ? (
              <Section id="final-games" title="Final" note={`${sums.finals.length} ${sums.finals.length === 1 ? "game" : "games"} · tip order`}>
                <FinalsTable rows={sums.finals} home={home} />
              </Section>
            ) : null}

            {stopped.length > 0 ? (
              <Section id="stopped-games" title="Postponed or canceled">
                <CardGrid games={stopped} lines={lines} modelVersion={view.modelVersion} modelNote={modelNote} columns={home ? 2 : 3} label="Postponed or canceled games" />
              </Section>
            ) : null}

            {next && nextGames.length > 0 && nextDay ? (
              <Section
                id="next-day"
                title={formatLongDay(nextDay)}
                note={
                  <Link href={dayHref(nextDay, today)} className="py-3 hover:text-ink hover:underline hover:underline-offset-4">
                    {next.kind === "future" ? "Projections, never scored" : "Next games"}
                    {next.games.length > nextGames.length ? ` · all ${next.games.length} games` : ""}
                  </Link>
                }
              >
                <CardGrid games={nextGames} lines={teamLines(liveState)} modelVersion={next.modelVersion} modelNote future columns={2} label={`Games on ${formatLongDay(nextDay)}`} />
              </Section>
            ) : null}
          </div>

          {home ? (
            <aside aria-label="Season and record" className="grid gap-[60px]">
              <TitleRace state={liveState} />
              <RecordGlance record={liveState.record} favorites={favorites} />
            </aside>
          ) : null}
        </div>

        {view.games.length > 0 ? <HowToRead view={view} /> : null}
      </main>
      {view.kind === "today" ? <AutoRefresh live={anyLive} /> : null}
    </>
  );
}
