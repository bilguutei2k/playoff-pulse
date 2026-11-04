import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/live/Badge";
import { SectionHeading } from "@/components/live/SectionHeading";
import { TeamLogo } from "@/components/live/TeamLogo";
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
  statusView,
  type GameLogRow,
  type PlayerPage as PlayerPageView,
} from "@/lib/view/players";
import { teamDisplay, teamHref } from "@/lib/view/teams";

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
  if (!page) return { title: "Player" };
  return {
    title: `${page.name}: stats, game log and injuries`,
    description: `${page.name} of the ${teamDisplay(page.teamId).name}: season averages, shooting, every game, his NBA injury report listings and 548's estimate of what his team loses without him.`,
  };
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <dt className="kicker">{label}</dt>
      <dd className="mt-1.5">
        <span className="figure text-[26px] font-semibold text-ink">{value}</span>
        {detail ? <span className="num ml-2 text-[12px] text-ink-3">{detail}</span> : null}
      </dd>
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
  const opponent = teamDisplay(next.opponentId);
  const source =
    status.source === "report"
      ? `NBA injury report of ${status.reportAt ? formatReportTime(status.reportAt, next.etDate) : "that day"}`
      : status.source === "box-score"
        ? "the model's inference from box scores; he is not on the report"
        : "his team's latest earlier report";
  const reason = reportReason(status.reason);
  const points = status.points >= 0.05 ? status.points.toFixed(1) : status.points > 0 ? "less than 0.1" : null;
  return (
    <div className="mt-4 rounded-lg bg-wash px-4 py-3 text-[14px] leading-6 text-ink-2">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone={view.tone}>{view.label}</Badge>
        <Link href={`/game/${next.gameId}`} className="pp-link">
          {formatWeekday(next.etDate)} {formatShortDay(next.etDate)} {next.home ? "vs" : "at"} {opponent.shortName}, {formatTimeEt(next.tipUtc)}
        </Link>
        {reason ? <span>{reason}</span> : null}
      </p>
      <p className="mt-1 text-[13px] text-ink-3">
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
  if (!row.result) return <span className="text-ink-3">–</span>;
  return (
    <span>
      <span className={`mr-1.5 font-semibold ${row.result.won ? "text-good" : "text-bad"}`}>{row.result.won ? "W" : "L"}</span>
      {row.result.teamScore}–{row.result.opponentScore}
    </span>
  );
}

const LOG_COLUMNS = ["Min", "Pts", "Reb", "Ast", "Stl", "Blk", "TO", "FG", "3P", "FT", "+/−"];

function GameLog({ page }: { page: PlayerPageView }) {
  const traded = page.teamIds.length > 1;
  return (
    <div className="table-scroll rounded-[var(--radius-card)] border border-line bg-panel">
      <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-[13.5px]">
        <caption className="sr-only">{page.name} game log, most recent first, including games he did not play.</caption>
        <thead>
          <tr className="text-left">
            <th scope="col" className="kicker sticky left-0 z-[1] border-b border-line-strong bg-panel py-2 pl-3 pr-2 font-medium sm:pl-4">Date</th>
            <th scope="col" className="kicker border-b border-line-strong px-2 py-2 font-medium">Game</th>
            <th scope="col" className="kicker border-b border-line-strong px-2 py-2 font-medium">Result</th>
            <th scope="col" className="kicker border-b border-line-strong px-2 py-2 font-medium">Role</th>
            {LOG_COLUMNS.map((label) => (
              <th key={label} scope="col" className="kicker border-b border-line-strong px-2 py-2 text-right font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.log.map((row) => {
            const entry = row.entry;
            const opponent = teamDisplay(row.opponentId);
            return (
              <tr key={`${row.teamId}-${row.gameId}`} className="group">
                <th scope="row" className="num sticky left-0 z-[1] whitespace-nowrap border-b border-line bg-panel py-2 pl-3 pr-2 text-left font-normal text-ink-2 group-hover:bg-wash sm:pl-4">
                  {formatWeekday(row.etDate)} {formatShortDay(row.etDate)}
                </th>
                <td className="whitespace-nowrap border-b border-line px-2 py-2 group-hover:bg-wash">
                  <Link href={`/game/${row.gameId}`} className="inline-flex items-center gap-1.5 text-ink hover:underline hover:decoration-pulse hover:underline-offset-4">
                    {traded ? <span className="num text-[12px] text-ink-3">{teamDisplay(row.teamId).code}</span> : null}
                    <span className="text-[12px] text-ink-3">{row.home ? "vs" : "at"}</span>
                    <TeamLogo teamId={row.opponentId} size={16} />
                    {opponent.code}
                  </Link>
                </td>
                <td className="num whitespace-nowrap border-b border-line px-2 py-2 group-hover:bg-wash"><ResultCell row={row} /></td>
                {entry.played ? (
                  <>
                    <td className="whitespace-nowrap border-b border-line px-2 py-2 text-[12.5px] text-ink-2 group-hover:bg-wash">{entry.starter ? "Starter" : "Bench"}</td>
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
                      <td key={index} className={`num whitespace-nowrap border-b border-line px-2 py-2 text-right group-hover:bg-wash ${index === 1 ? "font-semibold text-ink" : "text-ink-2"}`}>
                        {value}
                      </td>
                    ))}
                  </>
                ) : (
                  <td colSpan={LOG_COLUMNS.length + 1} className="border-b border-line px-2 py-2 text-[13px] text-ink-2 group-hover:bg-wash">
                    <span className="font-medium text-ink">Did not play</span>
                    <span className="text-ink-3"> · ESPN: {espnReason(entry.reason)}</span>
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
    <div className="table-scroll rounded-[var(--radius-card)] border border-line bg-panel">
      <table className="w-full min-w-[40rem] text-[13.5px]">
        <caption className="sr-only">{page.name}&apos;s listings on the NBA injury report before each finished game, and whether he then played.</caption>
        <thead>
          <tr className="border-b border-line-strong text-left">
            <th scope="col" className="kicker py-2 pl-3 pr-2 font-medium sm:pl-4">Game</th>
            <th scope="col" className="kicker px-2 py-2 font-medium">Report</th>
            <th scope="col" className="kicker px-2 py-2 font-medium">Status</th>
            <th scope="col" className="kicker px-2 py-2 font-medium">Reason</th>
            <th scope="col" className="kicker px-2 py-2 pr-4 font-medium">Then</th>
          </tr>
        </thead>
        <tbody>
          {page.listings.map((listing) => {
            const outcome = listingOutcome(listing.played);
            return (
              <tr key={`${listing.teamId}-${listing.gameId}`} className="border-b border-line last:border-0">
                <th scope="row" className="whitespace-nowrap py-2 pl-3 pr-2 text-left font-normal sm:pl-4">
                  <Link href={`/game/${listing.gameId}`} className="text-ink hover:underline hover:decoration-pulse hover:underline-offset-4">
                    <span className="num text-ink-2">{formatWeekday(listing.etDate)} {formatShortDay(listing.etDate)}</span>
                    {listing.opponentId ? (
                      <span className="ml-2">{listing.home ? "vs" : "at"} {teamDisplay(listing.opponentId).code}</span>
                    ) : null}
                  </Link>
                </th>
                <td className="num whitespace-nowrap px-2 py-2 text-ink-2">{formatReportTime(listing.reportAt, listing.etDate)}</td>
                <td className="px-2 py-2">
                  <Badge tone={statusView({ status: listing.status, source: "report", gamesMissed: 0 }).tone}>{STATUS_LABELS[listing.status]}</Badge>
                </td>
                <td className="px-2 py-2 text-ink-2">{reportReason(listing.reason)}</td>
                <td className="px-2 py-2 pr-4"><Badge tone={outcome.tone}>{outcome.label}</Badge></td>
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
      <main className="pp-container py-8 sm:py-10">
        <div className="panel px-6 py-10 text-center">
          <h1 className="headline text-[26px]">Player pages are not published yet</h1>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-ink-2">
            They appear once the forecast job publishes the season&apos;s player files.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3 text-[14px]">
            <Link className="pp-button" href="/players">Players</Link>
            <Link className="pp-button" href="/teams">Teams</Link>
          </div>
        </div>
      </main>
    );
  }
  if (!page) notFound();

  const team = teamDisplay(page.teamId);
  const entry = page.entry;
  const per = entry?.perGame ?? null;
  const formerTeams = page.teamIds.filter((teamId) => teamId !== page.teamId);
  const played = page.log.filter((row) => row.entry.played).length;
  const missed = page.log.length - played;

  return (
    <main className="pp-container py-8 sm:py-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-[14px]">
        <Link href="/players" className="text-ink-2 hover:text-ink"><span aria-hidden>← </span>All players</Link>
      </nav>

      <header className="panel p-5 sm:p-7">
        <p className="kicker">{[page.position, team.name].filter(Boolean).join(" · ")}</p>
        <h1 className="headline mt-1 text-[30px] sm:text-[40px]">{page.name}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-ink-2">
          <TeamLogo teamId={page.teamId} size={20} />
          <Link href={teamHref(page.teamId)} className="pp-link">{team.name}</Link>
          {formerTeams.length > 0 ? (
            <span>
              · also played for{" "}
              {formerTeams.map((teamId, index) => (
                <span key={teamId}>
                  {index > 0 ? ", " : ""}
                  <Link href={teamHref(teamId)} className="pp-link">{teamDisplay(teamId).shortName}</Link>
                </span>
              ))}{" "}
              this season
            </span>
          ) : null}
        </p>
        <CurrentStatusLine page={page} listsPublished={listsPublished} />
      </header>

      <section aria-labelledby="averages-title" className="mt-8">
        <SectionHeading
          id="averages-title"
          kicker="Season"
          title="Averages and shooting"
          dek={
            entry
              ? `Per game played: ${entry.games} ${entry.games === 1 ? "game" : "games"}, ${entry.starts} ${entry.starts === 1 ? "start" : "starts"}${entry.didNotPlay > 0 ? `, and ${entry.didNotPlay} ${entry.didNotPlay === 1 ? "game" : "games"} he did not play` : ""}.`
              : undefined
          }
        />
        {per && entry ? (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <Tile label="Minutes" value={formatAverage(per.minutes)} />
              <Tile label="Points" value={formatAverage(per.points)} />
              <Tile label="Rebounds" value={formatAverage(per.rebounds)} />
              <Tile label="Assists" value={formatAverage(per.assists)} />
              <Tile label="Steals" value={formatAverage(per.steals)} />
              <Tile label="Blocks" value={formatAverage(per.blocks)} />
              <Tile label="Turnovers" value={formatAverage(per.turnovers)} />
            </dl>
            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Tile label="Field goals" value={`${formatShooting(entry.shooting.fieldGoal)}%`} detail={`${madeAttempted(entry.totals.fieldGoalsMade, entry.totals.fieldGoalsAttempted)} made`} />
              <Tile label="Three-pointers" value={`${formatShooting(entry.shooting.threePoint)}%`} detail={`${madeAttempted(entry.totals.threePointersMade, entry.totals.threePointersAttempted)} made`} />
              <Tile label="Free throws" value={`${formatShooting(entry.shooting.freeThrow)}%`} detail={`${madeAttempted(entry.totals.freeThrowsMade, entry.totals.freeThrowsAttempted)} made`} />
            </dl>
          </>
        ) : (
          <p className="notice-quiet mt-4">He has not played a game this season.</p>
        )}
      </section>

      <section aria-labelledby="impact-title" className="mt-10">
        <div className="panel grid gap-5 p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:p-6">
          <div>
            <p className="kicker">The model&apos;s estimate</p>
            <h2 id="impact-title" className="headline mt-1 text-[22px]">548 impact</h2>
            <p className="mt-2">
              <span className="figure text-[44px] font-semibold text-ink">{formatImpact(page.impact)}</span>
              {page.impact !== null ? <span className="ml-2 text-[14px] text-ink-2">points per game</span> : null}
            </p>
          </div>
          <div className="text-[14px] leading-6 text-ink-2">
            <p className="font-medium text-ink">{IMPACT_LABEL}</p>
            <p className="mt-2">
              {page.impact === null
                ? "The model has no record of him yet, so it counts nothing when he is out."
                : "It comes from his box scores in the model's replay of the season, and is what the model takes off his team's expected margin in a game he misses. It does not move minutes to teammates, and it is not a ranking of players."}{" "}
              <Link href="/how-it-works#injuries" className="pp-link">How injuries work</Link>
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="log-title" className="mt-10">
        <SectionHeading
          id="log-title"
          kicker="Every game"
          title="Game log"
          dek={
            page.log.length > 0
              ? `Most recent first: ${played} played${missed > 0 ? ` and ${missed} he did not play, with ESPN's reason` : ""}. FG, 3P and FT are made–attempted.`
              : undefined
          }
        />
        <div className="mt-4">
          {page.log.length > 0 ? <GameLog page={page} /> : <p className="notice-quiet">No stored box score lists him yet.</p>}
        </div>
      </section>

      <section aria-labelledby="history-title" className="mt-10">
        <SectionHeading
          id="history-title"
          kicker="NBA injury report"
          title="Injury history"
          dek={`Each finished game for which the report in use before tip listed him, and whether he then played. Stored reports begin on ${formatLongDay(HISTORY_FROM)}.`}
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
  );
}
