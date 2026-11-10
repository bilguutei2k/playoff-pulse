import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusTag } from "@/components/live/Badge";
import { Hint } from "@/components/live/Hint";
import { SectionHeading } from "@/components/live/SectionHeading";
import { TeamLink } from "@/components/live/TeamLink";
import { getPlayerIndex, getTeamInjuryLists, getTeamPlayers } from "@/lib/live-data/published";
import { IMPACT_LABEL, type TeamPlayersFile } from "@/lib/season/player-stats";
import { formatLongDay, formatReportTime, formatShortDay, formatTimeEt, formatWeekday } from "@/lib/utils/dates";
import { STATUS_LABELS } from "@/lib/utils/injuries";
import {
  buildPlayerPage,
  espnReason,
  formatAverage,
  formatImpact,
  formatMinutes,
  formatShooting,
  listingOutcome,
  madeAttempted,
  reportReason,
  statusSourceText,
  statusView,
  type GameLogRow,
  type PlayerPage as PlayerPageView,
} from "@/lib/view/players";
import { teamDisplay } from "@/lib/view/teams";
import { Ticker } from "@/components/live/Ticker";

// Rendered on demand from the published data and re-rendered about once a minute
// (src/lib/live-data/published.ts). No paths are built ahead: data commits do not deploy.
export const revalidate = 60;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

type Params = { params: Promise<{ athleteId: string }> };

/** Injury history is stored from the first stored NBA report. */
const HISTORY_FROM = "2026-11-02";

async function load(athleteId: string): Promise<{ page: PlayerPageView | null; published: boolean; listsPublished: boolean }> {
  if (!/^\d+$/.test(athleteId)) return { page: null, published: true, listsPublished: false };
  const [index, lists] = await Promise.all([getPlayerIndex(), getTeamInjuryLists()]);
  if (!index && !lists) return { page: null, published: false, listsPublished: false };
  const entry = index?.players.find((player) => player.athleteId === athleteId);
  const listTeam = lists?.teams.find((team) => team.rows.some((row) => row.athleteId === athleteId))?.teamId;
  const teamIds = entry?.teamIds ?? (listTeam ? [listTeam] : []);
  const files = (await Promise.all(teamIds.map((teamId) => getTeamPlayers(teamId)))).filter(
    (file): file is TeamPlayersFile => file !== null,
  );
  return { page: buildPlayerPage({ athleteId, index, teamFiles: files, lists }), published: true, listsPublished: lists !== null };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { athleteId } = await params;
  const { page } = await load(athleteId);
  if (!page) return { title: "Player not found" };
  return {
    title: `${page.name}: stats, game log and injuries`,
    description: `${page.name} of the ${teamDisplay(page.teamId).name}: season averages, shooting, his game log from stored box scores, his NBA injury report listings and 548's estimate of what his team loses without him.`,
    alternates: { canonical: `/players/${athleteId}` },
  };
}

/** An unboxed figure, as on the team page: a grey label over a large number. */
function Figure({ label, value, detail }: { label: React.ReactNode; value: string; detail?: string }) {
  return (
    <div>
      <dt className="text-13 text-ink-2">{label}</dt>
      <dd className="num text-[28px] font-extrabold leading-[1.15] sm:text-32">{value}</dd>
      {detail ? <dd className="num text-13 text-ink-2">{detail}</dd> : null}
    </div>
  );
}

function CurrentStatusLine({ page, listsPublished }: { page: PlayerPageView; listsPublished: boolean }) {
  const status = page.status;
  if (!status) {
    if (!listsPublished) return null;
    return (
      <p className="mt-3 text-[14px] text-ink-2">
        Not on his team&apos;s injury list for its next game.{" "}
        <Link href="/injuries" className="pp-link">Injury report</Link>
      </p>
    );
  }
  const view = statusView(status);
  const next = status.nextGame;
  const source = statusSourceText(status, status.reportAt ? formatReportTime(status.reportAt, next.etDate) : null);
  const reason = reportReason(status.reason);
  const points = status.points >= 0.05 ? status.points.toFixed(1) : status.points > 0 ? "less than 0.1" : null;
  return (
    <div className="mt-6 max-w-[64ch] text-14 leading-6 text-ink-2">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusTag tone={view.tone}>{view.label}</StatusTag>
        <span>
          <Link href={`/game/${next.gameId}`} className="pp-link">
            {formatWeekday(next.etDate)} {formatShortDay(next.etDate)}, {formatTimeEt(next.tipUtc)}
          </Link>{" "}
          {next.home ? "vs" : "at"} <TeamLink teamId={next.opponentId} className="font-semibold text-ink" />
        </span>
        {reason ? <span>{reason}</span> : null}
      </p>
      <p className="mt-1 text-13 text-ink-2">
        Source: {source}.
        {points
          ? ` The model takes ${points} points off his team's expected margin for that game, weighted by his status.`
          : status.source === "box-score" && status.reportAt
            ? " He counts 0 for that game: his team is on the report and he is not listed, as at a seal."
            : ""}
      </p>
    </div>
  );
}

function ResultCell({ row }: { row: GameLogRow }) {
  if (!row.result) return <span className="text-ink-2">–</span>;
  return (
    <span>
      <span className={`mr-1.5 font-semibold ${row.result.won ? "text-good" : "text-bad"}`}>{row.result.won ? "W" : "L"}</span>
      {row.result.teamScore}–{row.result.opponentScore}
    </span>
  );
}

const LOG_COLUMNS = ["Min", "Pts", "Reb", "Ast", "Stl", "Blk", "TO", "FG", "3P", "FT", "+/−"];

/** The game a row is for: its date, linked to the game page, then "at" and the opponent, linked to his team. */
function GameCells({ gameId, etDate, opponentId, home, teamId }: { gameId: string; etDate: string; opponentId: string | null; home: boolean | null; teamId?: string }) {
  return (
    <>
      <th scope="row" className="whitespace-nowrap bg-panel text-left font-normal group-hover:bg-wash">
        <Link href={`/game/${gameId}`} className="players-name num text-ink">
          {formatWeekday(etDate)} {formatShortDay(etDate)}
        </Link>
      </th>
      <td className="whitespace-nowrap group-hover:bg-wash">
        {teamId ? <TeamLink teamId={teamId} form="code" className="mr-1.5 text-ink-2" /> : null}
        {opponentId ? (
          <>
            <span className="text-13 text-ink-2">{home ? "vs" : "at"}</span>{" "}
            <TeamLink teamId={opponentId} form="code" logo={16} />
          </>
        ) : (
          <span className="text-ink-2">–</span>
        )}
      </td>
    </>
  );
}

function GameLog({ page }: { page: PlayerPageView }) {
  const traded = page.teamIds.length > 1;
  return (
    <div className="table-scroll">
      <table className="tb players-tb min-w-[46rem]">
        <caption className="sr-only">
          {page.name}&apos;s game log, most recent first: every stored box score that lists him, played or not. Games
          whose box score does not list him are not included.
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Game</th>
            <th scope="col">Result</th>
            <th scope="col">Role</th>
            {LOG_COLUMNS.map((label) => (
              <th key={label} scope="col" className="nm">
                {label === "TO" ? (
                  <Hint term="TO" label="Turnovers">Times he lost the ball to the other team.</Hint>
                ) : (
                  label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.log.map((row) => {
            const entry = row.entry;
            return (
              <tr key={`${row.teamId}-${row.gameId}`} className="group">
                <GameCells gameId={row.gameId} etDate={row.etDate} opponentId={row.opponentId} home={row.home} teamId={traded ? row.teamId : undefined} />
                <td className="num whitespace-nowrap group-hover:bg-wash"><ResultCell row={row} /></td>
                {entry.played ? (
                  <>
                    <td className="whitespace-nowrap text-13 text-ink-2 group-hover:bg-wash">{entry.starter ? "Starter" : "Bench"}</td>
                    {[
                      formatMinutes(entry.minutes),
                      entry.points,
                      entry.offensiveRebounds + entry.defensiveRebounds,
                      entry.assists,
                      entry.steals,
                      entry.blocks,
                      entry.turnovers,
                      madeAttempted(entry.fieldGoalsMade, entry.fieldGoalsAttempted),
                      madeAttempted(entry.threePointersMade, entry.threePointersAttempted),
                      madeAttempted(entry.freeThrowsMade, entry.freeThrowsAttempted),
                      entry.plusMinus > 0 ? `+${entry.plusMinus}` : entry.plusMinus < 0 ? `−${Math.abs(entry.plusMinus)}` : "0",
                    ].map((value, index) => (
                      <td key={index} className={`nm whitespace-nowrap group-hover:bg-wash ${index === 1 ? "font-semibold" : "text-ink-2"}`}>
                        {value}
                      </td>
                    ))}
                  </>
                ) : (
                  <td colSpan={LOG_COLUMNS.length + 1} className="text-13 text-ink-2 group-hover:bg-wash">
                    <span className="font-medium text-ink">Did not play</span>
                    <span> · ESPN: {espnReason(entry.reason)}</span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InjuryHistory({ page }: { page: PlayerPageView }) {
  return (
    <div className="table-scroll">
      <table className="tb players-tb min-w-[36rem]">
        <caption className="sr-only">{page.name}&apos;s listings on the NBA injury report before each finished game, and whether he then played.</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Game</th>
            <th scope="col">Report</th>
            <th scope="col">Status</th>
            <th scope="col">Reason</th>
            <th scope="col">Then</th>
          </tr>
        </thead>
        <tbody>
          {page.listings.map((listing) => {
            const outcome = listingOutcome(listing.played);
            return (
              <tr key={`${listing.teamId}-${listing.gameId}`} className="group">
                <GameCells gameId={listing.gameId} etDate={listing.etDate} opponentId={listing.opponentId} home={listing.home} />
                <td className="whitespace-nowrap text-ink-2 group-hover:bg-wash">{formatReportTime(listing.reportAt, listing.etDate)}</td>
                <td className="group-hover:bg-wash">
                  <StatusTag tone={statusView({ status: listing.status, source: "report", gamesMissed: 0 }).tone}>{STATUS_LABELS[listing.status]}</StatusTag>
                </td>
                <td className="text-ink-2 group-hover:bg-wash">{reportReason(listing.reason)}</td>
                <td className="group-hover:bg-wash"><StatusTag tone={outcome.tone}>{outcome.label}</StatusTag></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function PlayerPage({ params }: Params) {
  const { athleteId } = await params;
  const { page, published, listsPublished } = await load(athleteId);
  if (!published) {
    return (
      <main className="pp-container pb-4 pt-7 sm:pt-11">
        <SectionHeading as="h1" kicker="Players" title="Player pages are not published yet" />
        <p className="mt-3 max-w-[64ch] text-15 text-ink-2">
          They appear once the forecast job publishes the season&apos;s player files.
        </p>
        <p className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-14">
          <Link className="pp-link" href="/players">All players</Link>
          <Link className="pp-link" href="/teams">All teams</Link>
        </p>
      </main>
    );
  }
  if (!page) notFound();

  const entry = page.entry;
  const per = entry?.perGame ?? null;
  const formerTeams = page.teamIds.filter((teamId) => teamId !== page.teamId);
  const played = page.log.filter((row) => row.entry.played).length;
  const missed = page.log.length - played;
  const noGames = !entry || entry.games === 0;

  return (
    <>
      <Ticker />
    <main className="pp-container pb-4 pt-7 sm:pt-11">
      <nav aria-label="Breadcrumb" className="mb-[22px] text-13">
        <Link href="/players" className="text-ink-2 hover:text-ink"><span aria-hidden>← </span>All players</Link>
      </nav>

      <header>
        <h1 className="headline text-32 sm:text-46">{page.name}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-15 text-ink-2">
          <TeamLink teamId={page.teamId} form="full" logo={20} className="font-semibold text-ink" />
          {page.position ? <span>· {page.position}</span> : null}
          {formerTeams.length > 0 ? (
            <span>
              · also played for{" "}
              {formerTeams.map((teamId, index) => (
                <span key={teamId}>
                  {index > 0 ? ", " : ""}
                  <TeamLink teamId={teamId} className="font-semibold text-ink" />
                </span>
              ))}{" "}
              this season
            </span>
          ) : null}
        </p>
        <CurrentStatusLine page={page} listsPublished={listsPublished} />
      </header>

      <section aria-labelledby="averages-title" className="mt-12">
        <SectionHeading
          id="averages-title"
          note="Season"
          title="Averages and shooting"
          dek={
            entry && !noGames
              ? `Per game played: ${entry.games} ${entry.games === 1 ? "game" : "games"}, ${entry.starts} ${entry.starts === 1 ? "start" : "starts"}${entry.didNotPlay > 0 ? `, plus ${entry.didNotPlay} ${entry.didNotPlay === 1 ? "box score that lists" : "box scores that list"} him as not playing` : ""}.`
              : undefined
          }
        />
        {per && entry ? (
          <>
            <dl className="mt-5 grid grid-cols-3 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-7">
              <Figure label="Minutes" value={formatAverage(per.minutes)} />
              <Figure label="Points" value={formatAverage(per.points)} />
              <Figure label="Rebounds" value={formatAverage(per.rebounds)} />
              <Figure label="Assists" value={formatAverage(per.assists)} />
              <Figure label="Steals" value={formatAverage(per.steals)} />
              <Figure label="Blocks" value={formatAverage(per.blocks)} />
              <Figure label="Turnovers" value={formatAverage(per.turnovers)} />
            </dl>
            <dl className="mt-6 grid grid-cols-3 gap-x-6 gap-y-5 border-t border-line pt-5 sm:grid-cols-4 lg:grid-cols-7">
              <Figure label="Field goals" value={`${formatShooting(entry.shooting.fieldGoal)}%`} detail={`${madeAttempted(entry.totals.fieldGoalsMade, entry.totals.fieldGoalsAttempted)} made`} />
              <Figure label="Three-pointers" value={`${formatShooting(entry.shooting.threePoint)}%`} detail={`${madeAttempted(entry.totals.threePointersMade, entry.totals.threePointersAttempted)} made`} />
              <Figure label="Free throws" value={`${formatShooting(entry.shooting.freeThrow)}%`} detail={`${madeAttempted(entry.totals.freeThrowsMade, entry.totals.freeThrowsAttempted)} made`} />
            </dl>
          </>
        ) : (
          <p className="notice-quiet mt-4">He has not played a game this season.</p>
        )}
      </section>

      <section aria-labelledby="impact-title" className="mt-12">
        <SectionHeading id="impact-title" note="The model's estimate" title="548 impact" />
        <div className="mt-5 grid gap-x-10 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
          <p>
            <span className="figure num text-46">{formatImpact(page.impact)}</span>
            {page.impact !== null ? <span className="ml-2 text-14 text-ink-2">points per game</span> : null}
          </p>
          <div className="max-w-[64ch] text-14 leading-6 text-ink-2">
            <p className="font-medium text-ink">{IMPACT_LABEL}</p>
            <p className="mt-2">
              {page.impact === null
                ? "The model has no record of him yet, so it counts nothing when he is out."
                : noGames
                  ? "He has no box score this season, so it comes from his box scores in earlier seasons of the model's replay, which starts in 2020-21. It is what the model takes off his team's expected margin in a game he misses. It does not move minutes to teammates, and it is not a ranking of players."
                  : "It comes from his box scores in the model's replay of the season, and is what the model takes off his team's expected margin in a game he misses. It does not move minutes to teammates, and it is not a ranking of players."}{" "}
              <Link href="/how-it-works#injuries" className="pp-link">How injuries work</Link>
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="log-title" className="mt-12">
        <SectionHeading
          id="log-title"
          note={
            page.log.length > 0
              ? `${page.log.length} ${page.log.length === 1 ? "box score" : "box scores"} list him`
              : undefined
          }
          title="Game log"
          dek={
            page.log.length > 0 ? (
              <span className="block max-w-[64ch]">
                Each stored box score that lists him, most recent first: {played} played
                {missed > 0 ? `, ${missed} on the box score without playing, with ESPN's reason` : ""}. A game whose box
                score does not list him is not shown. FG, 3P and FT are made–attempted.
              </span>
            ) : undefined
          }
        />
        <div className="mt-4">
          {page.log.length > 0 ? <GameLog page={page} /> : <p className="notice-quiet">No stored box score lists him yet.</p>}
        </div>
      </section>

      <section aria-labelledby="history-title" className="mt-12">
        <SectionHeading
          id="history-title"
          note="NBA injury report"
          title="Injury history"
          dek={
            <span className="block max-w-[64ch]">
              Each finished game for which the report in use before tip listed him, and whether he then played. Stored
              reports begin on {formatLongDay(HISTORY_FROM)}.
            </span>
          }
        />
        <div className="mt-4">
          {page.listings.length > 0 ? (
            <InjuryHistory page={page} />
          ) : (
            <p className="notice-quiet">The NBA injury report has not listed him before a finished game since {formatLongDay(HISTORY_FROM)}.</p>
          )}
        </div>
      </section>
    </main>
    </>
  );
}
