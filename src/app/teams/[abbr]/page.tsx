import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { lostPoints } from "@/components/live/AbsenceList";
import { Badge } from "@/components/live/Badge";
import { InjuryTable } from "@/components/live/InjuryTable";
import { PlayerLink } from "@/components/live/PlayerLink";
import { PlayersTable } from "@/components/live/PlayersTable";
import { RatingChart, type RatingChartPoint } from "@/components/live/RatingChart";
import { TeamLogo } from "@/components/live/TeamLogo";
import { TeamNextGames } from "@/components/live/TeamNextGames";
import { Ticker } from "@/components/live/Ticker";
import { Tile } from "@/components/live/Tile";
import {
  getLiveState,
  getPlayerIndex,
  getProjections,
  getSeasonGames,
  getSeasonLedger,
  getTeamInjuryLists,
  getTeamPlayers,
} from "@/lib/live-data/published";
import { IMPACT_LABEL } from "@/lib/season/player-stats";
import { PROJECTION_WITH_INJURIES_LABEL } from "@/lib/season/projections";
import { teamById } from "@/lib/season/teams";
import type { PublishedAbsence } from "@/lib/season/types";
import { formatLongDay, formatShortDay, formatTimeEt, formatWeekday } from "@/lib/utils/dates";
import { formatChance } from "@/lib/utils/format";
import { injuriesHref } from "@/lib/view/filters";
import { blockFromList } from "@/lib/view/injury-report";
import { formatRating, oddsRows, type OddsRow } from "@/lib/view/odds";
import { teamRoster } from "@/lib/view/players";
import { PROJECTION_LABEL } from "@/lib/view/projection";
import { ratingHistory } from "@/lib/view/rating-history";
import { teamSchedule, type TeamGameRow } from "@/lib/view/team";
import { gameBlocks, nextGameBars, possessive, recordBand, teamPercent } from "@/lib/view/team-page";
import { conferenceOrder, formatRecord, ordinal, teamBySlug, teamColor, teamDisplay } from "@/lib/view/teams";

type Params = { params: Promise<{ abbr: string }> };

// Rendered on demand from main's published data and re-rendered about once a minute
// (src/lib/live-data/published.ts). No paths are built ahead: data commits do not deploy.
export const revalidate = 60;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { abbr } = await params;
  const team = teamBySlug(abbr);
  if (!team) return { title: "Team not found" };
  return {
    title: `${team.name}: schedule, forecasts and odds`,
    description: `${team.name} record, 548 rating, playoff and title odds, and every game with its forecast.`,
  };
}

const RESULTS_SHOWN = 10;
const UPCOMING_SHOWN = 10;

function BigFigure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className="num text-[34px] font-extrabold leading-[1.1] sm:text-[46px]">{value}</dd>
      {note ? <dd className="text-[13px] text-ink-2">{note}</dd> : null}
    </div>
  );
}

function OddsFigure({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className="num text-[28px] font-extrabold leading-tight">{formatChance(value)}</dd>
      <dd aria-hidden className="bar mt-1.5 h-2">
        <i style={{ width: `${Math.max(1, Math.min(100, value * 100))}%`, background: color }} />
      </dd>
    </div>
  );
}

function ProjectedRecord({ row, color }: { row: OddsRow; color: string }) {
  const band = recordBand(row);
  return (
    <div className="mt-[34px]">
      <p className="flex items-baseline justify-between gap-4">
        <span className="text-[13px] text-ink-2">Projected record</span>
        <span className="num text-[24px] font-extrabold">
          {Math.round(row.projectedWins)}–{Math.round(row.projectedLosses)}
        </span>
      </p>
      <div
        className="relative mt-2.5 h-[26px]"
        role="img"
        aria-label={`${row.projectedWinsP10} to ${row.projectedWinsP90} wins in 8 of 10 simulations, ${Math.round(row.projectedWins)} on average, out of ${band.total} games`}
      >
        <i className="absolute inset-x-0 top-3 h-0.5 bg-line" />
        <i className="absolute top-1.5 h-3.5" style={{ left: `${band.low}%`, width: `${band.high - band.low}%`, background: color }} />
        <i className="absolute top-0 h-[26px] w-[3px] -translate-x-1/2 bg-ink" style={{ left: `${band.mean}%` }} />
      </div>
      <div aria-hidden className="num relative mt-1 h-[18px] text-[13px] text-ink-2">
        <span className="absolute left-0">0</span>
        {band.low > 6 ? (
          <span className="absolute -translate-x-1/2" style={{ left: `${band.low}%` }}>
            {row.projectedWinsP10}
          </span>
        ) : null}
        {band.high < 94 && band.high - band.low > 6 ? (
          <span className="absolute -translate-x-1/2" style={{ left: `${band.high}%` }}>
            {row.projectedWinsP90}
          </span>
        ) : null}
        <span className="absolute right-0">{band.total}</span>
      </div>
      <p className="mt-1.5 text-[13px] text-ink-2">Wins in 8 of 10 simulations</p>
    </div>
  );
}

function OutNow({ rows, color }: { rows: PublishedAbsence[]; color: string }) {
  return (
    <table className="tb">
      <caption className="sr-only">Players the model counts as out now, the points of margin each costs, and the games each is expected to miss</caption>
      <thead>
        <tr>
          <th scope="col">Player</th>
          <th scope="col" className="nm">Points</th>
          <th scope="col">Games out, expected</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const { blocks, more } = gameBlocks(row.expectedGames);
          return (
            <tr key={row.athleteId}>
              <th scope="row" className="text-left">
                <PlayerLink athleteId={row.athleteId} name={row.name} />
              </th>
              <td className="nm num">{lostPoints(row.points).replace(" pts", "")}</td>
              <td>
                <span className="flex items-center gap-0.5">
                  {Array.from({ length: blocks }, (_, index) => (
                    <i key={index} aria-hidden className="block h-3 w-[7px]" style={{ background: color }} />
                  ))}
                  {more > 0 ? <span className="ml-1 text-[13px] text-ink-2">+{more}</span> : null}
                  <span className="sr-only">about {Math.round(row.expectedGames)} more games</span>
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Opponent({ row }: { row: TeamGameRow }) {
  return (
    <Link href={`/game/${row.game.id}`} className="inline-flex items-center gap-2 whitespace-nowrap hover:underline hover:underline-offset-4">
      <span className="w-5 text-ink-2">{row.home ? "vs" : "at"}</span>
      <TeamLogo teamId={row.opponentId} size={18} />
      {teamDisplay(row.opponentId).shortName}
    </Link>
  );
}

/** The 548 column: a sealed tile, a dashed projection tile, a miss, or nothing before the record. */
function NumberCell({ row, modelVersion }: { row: TeamGameRow; modelVersion: string }) {
  if (row.forecast) {
    const projection = row.forecast.source === "projection";
    const older = !projection && row.forecast.modelVersion !== null && row.forecast.modelVersion !== modelVersion;
    return (
      <span className="inline-flex items-center gap-1.5">
        <Tile
          kind={projection ? "dash" : "sealed"}
          size="xs"
          className="!min-w-[44px] !text-[13px]"
          title={
            projection
              ? row.forecast.withInjuries
                ? "Projection with the injury term. Not sealed, never scored."
                : "Projection from ratings alone, before injuries. Not sealed, never scored."
              : older
                ? `Sealed by ${row.forecast.modelVersion}, which does not account for injuries`
                : "Sealed before tip"
          }
        >
          {teamPercent(row.forecast.probability)}%
        </Tile>
        {older ? <span className="text-[13px] text-ink-2">{row.forecast.modelVersion!.split("-").at(-1)}</span> : null}
      </span>
    );
  }
  if (row.missed) return <Badge tone="bad">Missed</Badge>;
  return <span className="whitespace-nowrap text-[13px] text-ink-2">{row.result ? "Not in record" : "–"}</span>;
}

function ResultsTable({ rows, modelVersion, caption }: { rows: TeamGameRow[]; modelVersion: string; caption: string }) {
  return (
    <table className="tb">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Opponent</th>
          <th scope="col">Result</th>
          <th scope="col" className="nm">548 sealed</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.game.id}>
            <td className="whitespace-nowrap">
              <span className="hidden sm:inline">{formatWeekday(row.game.etDate)} </span>
              {formatShortDay(row.game.etDate)}
            </td>
            <th scope="row" className="text-left">
              <Opponent row={row} />
            </th>
            <td className="num whitespace-nowrap">
              {row.result ? (
                <>
                  <b>{row.result.won ? "W" : "L"}</b> {row.result.teamScore}–{row.result.opponentScore}
                </>
              ) : null}
            </td>
            <td className="nm">
              <NumberCell row={row} modelVersion={modelVersion} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScheduleTable({ rows, caption, modelVersion }: { rows: TeamGameRow[]; caption: string; modelVersion: string }) {
  return (
    <table className="tb">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Opponent</th>
          <th scope="col">Tip</th>
          <th scope="col" className="nm">548</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const ratingsOnly = row.forecast?.source === "projection" && !row.forecast.withInjuries;
          const previous = rows[index - 1]?.forecast;
          const startsGroup = ratingsOnly && !(previous?.source === "projection" && !previous.withInjuries);
          return [
            startsGroup ? (
              <tr key={`${row.game.id}-group`} className="gap">
                <td colSpan={4} className="text-[13px] text-ink-2">
                  <b className="text-ink">Later games</b> are projected from ratings alone, before injuries, until they
                  are within a week.
                </td>
              </tr>
            ) : null,
            <tr key={row.game.id}>
              <td className="whitespace-nowrap">
                <span className="hidden sm:inline">{formatWeekday(row.game.etDate)} </span>
                {formatShortDay(row.game.etDate)}
              </td>
              <th scope="row" className="text-left">
                <Opponent row={row} />
              </th>
              <td className="num whitespace-nowrap text-ink-2">
                {row.game.status === "postponed" ? "Postponed" : row.game.status === "in-progress" ? <b className="text-ink">Live</b> : formatTimeEt(row.game.tipUtc)}
              </td>
              <td className="nm">
                <NumberCell row={row} modelVersion={modelVersion} />
              </td>
            </tr>,
          ];
        })}
      </tbody>
    </table>
  );
}

const SEED_COLORS = ["#111111", "#666666", "#8a8a8a"];
const seedColor = (index: number) => SEED_COLORS[index < 6 ? 0 : index < 10 ? 1 : 2];

function SeedChart({ row }: { row: OddsRow }) {
  const max = Math.max(0.05, ...row.seeds);
  const top = [...row.seeds.keys()].sort((a, b) => row.seeds[b] - row.seeds[a]).slice(0, 3);
  return (
    <div>
      <div
        className="flex h-40 items-end gap-[3px] border-b border-ink"
        role="img"
        aria-label={`${row.shortName} seed chances: ${row.seeds.map((value, i) => `${ordinal(i + 1)} ${formatChance(value)}`).join(", ")}`}
      >
        {row.seeds.map((value, index) => (
          <div key={index} className="flex h-full flex-1 flex-col items-center justify-end" title={`${ordinal(index + 1)} seed: ${formatChance(value)}`}>
            {top.includes(index) && value >= 0.005 ? <span className="num mb-1 text-[11px] font-bold">{formatChance(value)}</span> : null}
            <span
              className="block w-full max-w-6"
              style={{ height: `${(value / max) * 85}%`, minHeight: value > 0 ? 1 : 0, background: seedColor(index) }}
            />
          </div>
        ))}
      </div>
      <div aria-hidden className="mt-1 flex gap-[3px]">
        {row.seeds.map((_, index) => (
          <span key={index} className="num flex-1 text-center text-[11px] text-ink-2">
            {index + 1}
          </span>
        ))}
      </div>
      <p className="legend mt-3">
        <span>
          <i style={{ background: SEED_COLORS[0] }} />
          Seeds 1–6, straight in
        </span>
        <span>
          <i style={{ background: SEED_COLORS[1] }} />
          7–10, play-in
        </span>
        <span>
          <i style={{ background: SEED_COLORS[2] }} />
          11–15, out
        </span>
      </p>
    </div>
  );
}

export default async function TeamPage({ params }: Params) {
  const { abbr } = await params;
  const team = teamBySlug(abbr);
  if (!team) notFound();
  if (team.slug !== abbr) permanentRedirect(`/teams/${team.slug}`);

  const [liveState, games, ledger, history, projections, lists, players, index] = await Promise.all([
    getLiveState(),
    getSeasonGames(),
    getSeasonLedger(),
    ratingHistory(),
    getProjections(),
    getTeamInjuryLists(),
    getTeamPlayers(team.id),
    getPlayerIndex(),
  ]);
  const rows = oddsRows(liveState, games);
  const row = rows.find((candidate) => candidate.teamId === team.id);
  if (!row) notFound();
  const color = teamColor(team.id);
  const division = teamById(team.id).division;
  const standing = conferenceOrder(liveState.forecast.teams, team.conference).findIndex((t) => t.teamId === team.id) + 1;
  const schedule = teamSchedule({ state: liveState, games, ledger, teamId: team.id, projections });
  const played = schedule.filter((game) => game.result !== null).reverse();
  const upcoming = schedule.filter((game) => game.result === null);
  const anySealed = played.some((game) => game.forecast?.source === "sealed");
  const bars = nextGameBars(upcoming);
  const anySealedBar = bars.some((bar) => bar.sealed);
  const chartPoints: RatingChartPoint[] = history.map((point) => {
    const values = Object.values(point.ratings).sort((a, b) => a - b);
    const quantile = (q: number) => values[Math.round(q * (values.length - 1))];
    return {
      date: point.date,
      preseason: point.preseason,
      team: point.ratings[team.id],
      min: values[0],
      q1: quantile(0.25),
      q3: quantile(0.75),
      max: values.at(-1)!,
    };
  });
  const modeled = liveState.injury !== null;
  const absences = liveState.absences.filter((absence) => absence.teamId === team.id).sort((a, b) => b.points - a.points);
  const teamList = lists?.teams.find((candidate) => candidate.teamId === team.id) ?? null;
  const injuryBlock = teamList ? blockFromList(teamList) : null;
  const roster = players ? teamRoster(players, index, lists) : null;
  const projectedWithInjuries = upcoming.some((game) => game.forecast?.source === "projection" && game.forecast.withInjuries);
  const projectedWithout = upcoming.some((game) => game.forecast?.source === "projection" && !game.forecast.withInjuries);
  const showNow = modeled && row.ratingNow !== null;
  const recordStart = liveState.ledgerStartedAt ? formatShortDay(liveState.ledgerStartedAt.slice(0, 10)) : null;

  return (
    <>
      <Ticker />
      <main className="pp-container pb-4 pt-7 sm:pt-11">
        <nav aria-label="Breadcrumb" className="mb-[22px] text-[13px]">
          <Link href="/teams" className="text-ink-2 hover:text-ink">
            <span aria-hidden>← </span>All teams
          </Link>
        </nav>
        <header>
          <div className="flex items-center gap-4">
            <TeamLogo teamId={team.id} size={48} />
            <h1 className="headline text-[32px] sm:text-[46px]">{team.name}</h1>
          </div>
          <p className="mb-9 mt-2 text-ink-2">
            {team.conference}ern Conference · {division}
          </p>
          <dl className="grid gap-6 sm:grid-cols-3 sm:gap-12">
            <BigFigure label="Record" value={formatRecord(row.wins, row.losses)} note={`${ordinal(standing)} in the ${team.conference}`} />
            <BigFigure label="Rating" value={formatRating(row.rating)} note={`${ordinal(row.ratingRank)} of 30`} />
            {showNow ? (
              <BigFigure
                label="Rating next game"
                value={formatRating(row.ratingNow!)}
                note={absences.length > 0 ? `with ${absences.length} ${absences.length === 1 ? "player" : "players"} out` : "nobody counted out"}
              />
            ) : null}
          </dl>
        </header>

        <div className="mt-14 grid items-start gap-x-[72px] gap-y-16 sm:mt-[72px] lg:grid-cols-2">
          <div className="min-w-0">
            <section aria-labelledby="odds-title">
              <div className="sh">
                <h2 id="odds-title">Season odds</h2>
                <Link href="/odds">Every team&apos;s odds</Link>
              </div>
              <dl className="grid grid-cols-2 gap-[22px] sm:grid-cols-4">
                <OddsFigure label="Make playoffs" value={row.makePlayoffs} color={color} />
                <OddsFigure label="Play-in" value={row.playIn} color={color} />
                <OddsFigure label="Top six" value={row.topSix} color={color} />
                <OddsFigure label="Title" value={row.champion} color={color} />
              </dl>
              <ProjectedRecord row={row} color={color} />
              <p className="mt-4 text-[13px] text-ink-2">
                From {liveState.forecast.iterations.toLocaleString("en-US")} simulations of the rest of the season.
                Midseason playoff odds are not claimed to be well calibrated, and no skill is claimed for title odds.
              </p>
            </section>

            <section aria-labelledby="next-title" className="mt-16">
              <div className="sh">
                <h2 id="next-title">Next {bars.length === 1 ? "game" : `${bars.length === 10 ? "ten" : bars.length} games`}</h2>
                <span>
                  {possessive(team.shortName)} chance · {anySealedBar ? "solid: sealed, dashed: projections, never scored" : "projections, never scored"}
                </span>
              </div>
              {bars.length > 0 ? (
                <>
                  <TeamNextGames bars={bars} color={color} name={possessive(team.shortName)} />
                  <p className="mt-3 text-[13px] text-ink-2">
                    {projectedWithInjuries
                      ? `${PROJECTION_WITH_INJURIES_LABEL}${projectedWithout ? " Games more than a week away are projected from ratings alone, before injuries." : ""}`
                      : PROJECTION_LABEL}
                  </p>
                </>
              ) : (
                <p className="notice-quiet">No games left on the schedule.</p>
              )}
            </section>
          </div>

          <div className="min-w-0">
            <section aria-labelledby="out-title">
              <div className="sh">
                <h2 id="out-title">Out now</h2>
                {modeled ? (
                  <span>
                    <b className="num text-ink">{lostPoints(liveState.absencePoints[team.id] ?? 0).replace(" pts", "")}</b> pts next game
                  </span>
                ) : null}
              </div>
              {!modeled ? (
                <p className="notice-quiet">
                  Injuries are not in this forecast yet: it comes from {liveState.modelVersion}, which does not account for
                  the NBA injury report.
                </p>
              ) : absences.length > 0 ? (
                <>
                  <OutNow rows={absences} color={color} />
                  <p className="mt-3 text-[13px] leading-5 text-ink-2">
                    Who the season simulation counts as out: listed out or doubtful on the NBA report, or missed the last
                    game and not listed. Expected games come from a return table fitted on past seasons, never reported
                    return dates. A game&apos;s seal counts the report in use at its seal instead, or these absences if
                    the team has not filed its report yet.
                  </p>
                </>
              ) : (
                <p className="notice-quiet">The model counts no {team.shortName} player as out right now.</p>
              )}
            </section>

            <section aria-labelledby="results-title" className="mt-16">
              <div className="sh">
                <h2 id="results-title">Results</h2>
                {recordStart ? <span>Record starts {recordStart}</span> : null}
              </div>
              {played.length === 0 ? (
                <p className="notice-quiet">No games played yet.</p>
              ) : (
                <>
                  {!anySealed ? <p className="notice-quiet mb-3">No {team.shortName} game has been sealed and played yet.</p> : null}
                  <ResultsTable rows={played.slice(0, RESULTS_SHOWN)} modelVersion={liveState.modelVersion} caption={`${team.shortName} results, most recent first, with 548's sealed chance for this team`} />
                  {played.length > RESULTS_SHOWN ? (
                    <details className="group mt-3">
                      <summary className="pp-button cursor-pointer list-none">
                        <span className="group-open:hidden">Show the other {played.length - RESULTS_SHOWN} results</span>
                        <span className="hidden group-open:inline">Hide earlier results</span>
                      </summary>
                      <div className="mt-3">
                        <ResultsTable rows={played.slice(RESULTS_SHOWN)} modelVersion={liveState.modelVersion} caption={`${team.shortName} earlier results`} />
                      </div>
                    </details>
                  ) : null}
                  <p className="mt-3 text-[13px] text-ink-2">
                    548&apos;s sealed pregame chance for the {team.shortName}. v1 numbers do not account for injuries.
                  </p>
                </>
              )}
            </section>
          </div>
        </div>

        {modeled && lists ? (
          <section aria-labelledby="injuries-title" className="mt-16">
            <div className="sh">
              <h2 id="injuries-title">Injury list for the next game</h2>
              <Link href={injuriesHref(team.id)}>On the injury report</Link>
            </div>
            {injuryBlock ? (
              <>
                <p className="mb-4 max-w-3xl text-[13px] leading-5 text-ink-2">
                  The NBA report&apos;s listings and the players the model infers from box scores, with the points of
                  margin it counts for each. A projection, never a seal: a game&apos;s seals count the report in use
                  when they are made.
                </p>
                <InjuryTable block={injuryBlock} showGame />
              </>
            ) : (
              <p className="notice-quiet">The {team.shortName} have no game scheduled, so there is no injury list.</p>
            )}
          </section>
        ) : null}

        <section aria-labelledby="roster-title" className="mt-16">
          <div className="sh">
            <h2 id="roster-title">Roster and season stats</h2>
            <Link href="/players">Every player</Link>
          </div>
          {roster && roster.length > 0 ? (
            <>
              <p className="mb-4 max-w-3xl text-[13px] leading-5 text-ink-2">
                Per game played for the {team.shortName}, most minutes first; select a column heading to sort. A traded
                player counts only his games here. {IMPACT_LABEL}
              </p>
              <PlayersTable
                rows={roster}
                caption={`${team.name} roster: season averages, shooting, 548 impact and injury status.`}
                showTeam={false}
                controls={false}
                initialSort={{ key: "minutes", descending: true }}
              />
            </>
          ) : (
            <p className="notice-quiet">{roster ? `No ${team.shortName} box score is stored yet.` : "Player stats are not published yet."}</p>
          )}
          {players && players.games.length > 0 ? (
            <p className="mt-3 text-[13px] text-ink-2">
              From {players.games.length} stored {players.games.length === 1 ? "box score" : "box scores"}, the latest on{" "}
              {formatLongDay(players.games.at(-1)!.etDate)}.
            </p>
          ) : null}
        </section>

        <div className="mt-16 grid items-start gap-x-[72px] gap-y-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <section aria-labelledby="seeds-title">
            <div className="sh">
              <h2 id="seeds-title">Seed chances</h2>
              <span>Where they finish</span>
            </div>
            <SeedChart row={row} />
          </section>
          <section aria-labelledby="rating-title">
            <div className="sh">
              <h2 id="rating-title">Rating over time</h2>
              <span>Points per game vs. average</span>
            </div>
            {chartPoints.length > 0 ? (
              <RatingChart points={chartPoints} color={color} name={team.shortName} published={row.rating} />
            ) : (
              <p className="notice-quiet">The rating history could not be rebuilt for this build.</p>
            )}
            <p className="mt-3 text-[13px] leading-5 text-ink-2">
              Points per game against an average team after each game day, rebuilt from results with the rating model
              alone, without the injury adjustment. The shaded bands are the league&apos;s full spread and its middle half.
              {modeled ? " The open marker is today's published rating, which adjusts past margins for who played to approximate full strength." : ""}
            </p>
          </section>
        </div>

        <section aria-labelledby="upcoming-title" className="mt-16">
          <div className="sh">
            <h2 id="upcoming-title">Schedule</h2>
            <span>{upcoming.length} {upcoming.length === 1 ? "game" : "games"} left</span>
          </div>
          {upcoming.length === 0 ? (
            <p className="notice-quiet">No games left on the schedule.</p>
          ) : (
            <>
              <ScheduleTable modelVersion={liveState.modelVersion} rows={upcoming.slice(0, UPCOMING_SHOWN)} caption={`${team.shortName} upcoming games`} />
              {upcoming.length > UPCOMING_SHOWN ? (
                <details className="group mt-3">
                  <summary className="pp-button cursor-pointer list-none">
                    <span className="group-open:hidden">Show the other {upcoming.length - UPCOMING_SHOWN} games</span>
                    <span className="hidden group-open:inline">Hide the rest of the schedule</span>
                  </summary>
                  <div className="mt-3">
                    <ScheduleTable modelVersion={liveState.modelVersion} rows={upcoming.slice(UPCOMING_SHOWN)} caption={`${team.shortName} later games`} />
                  </div>
                </details>
              ) : null}
              <p className="mt-3 text-[13px] text-ink-2">
                Times ET. Solid tile: sealed. Dashed tile: a projection, never sealed or scored.
              </p>
            </>
          )}
        </section>
      </main>
    </>
  );
}
