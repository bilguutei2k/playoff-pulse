import Link from "next/link";
import { TeamLink } from "@/components/live/TeamLink";
import { Tile } from "@/components/live/Tile";
import type { MissedRow } from "@/lib/season/types";
import { formatShortDay, formatWeekday } from "@/lib/utils/dates";
import { splitPercents } from "@/lib/view/card";
import { CALIBRATION_MIN_GAMES, SMALL_SAMPLE_GAMES, type CalibrationBin, type ScoredGame } from "@/lib/view/record";
import { brierShare, favoriteLost, scoredByDate, waffleCells } from "@/lib/view/record-page";
import { gameHref } from "@/lib/view/routes";
import { teamDisplay } from "@/lib/view/teams";

/**
 * "MIA at LAL" with both logos, each team a link to its page (the code prints, the
 * accessible name is the full name). Raised, so a cell's game cover stays beneath.
 */
export function Matchup({ awayId, homeId }: { awayId: string; homeId: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <TeamLink teamId={awayId} form="code" logo={18} raised />
      <span className="text-ink-2">at</span>
      <TeamLink teamId={homeId} form="code" logo={18} raised />
    </span>
  );
}

/**
 * Makes the rest of a cell open the game too. The real link is the tile's; this copy
 * is hidden from the keyboard and screen readers. Each cell holds its own cover, never
 * the row (Safari ignores position: relative on a <tr>; see DayFinals).
 */
function CellLink({ gameId }: { gameId: string }) {
  return <Link href={gameHref(gameId)} aria-hidden tabIndex={-1} className="absolute inset-0" />;
}

/** "Thunder at Lakers, Nov 3": the game link's accessible name. */
function gameLabel(awayId: string, homeId: string, etDate: string): string {
  return `${teamDisplay(awayId).shortName} at ${teamDisplay(homeId).shortName}, ${formatShortDay(etDate)}: game details`;
}

/**
 * The record's progress toward 500 scored games, one cell a game: ink for scored,
 * an outline for sealed and not final yet. Cells 100 (calibration opens) and 500 (the
 * market comparison) are grey until they are reached. 50 columns wide, 25 on a phone.
 */
export function Waffle({ scored, pending }: { scored: number; pending: number }) {
  const cells = waffleCells(scored, pending);
  return (
    <div>
      <div
        role="img"
        aria-label={`${scored} of ${SMALL_SAMPLE_GAMES} games scored, ${pending} sealed and not final yet. Calibration opens at game ${CALIBRATION_MIN_GAMES}, the market comparison at game ${SMALL_SAMPLE_GAMES}.`}
        className="grid grid-cols-[repeat(25,minmax(0,1fr))] gap-[3px] sm:grid-cols-[repeat(50,minmax(0,1fr))]"
      >
        {cells.map((cell, index) => (
          <i
            key={index}
            className={`block aspect-square ${
              cell === "scored"
                ? "bg-ink"
                : cell === "pending"
                  ? "bg-white shadow-[inset_0_0_0_2px_#111111]"
                  : index === CALIBRATION_MIN_GAMES - 1 || index === SMALL_SAMPLE_GAMES - 1
                    ? "bg-ink-2"
                    : "bg-line"
            }`}
          />
        ))}
      </div>
      <div className="legend mt-3">
        <span>
          <i className="bg-ink" />
          Scored
        </span>
        <span>
          <i className="shadow-[inset_0_0_0_2px_#111111]" />
          Sealed, not final yet
        </span>
        <span>
          <i className="bg-ink-2" />
          Game {CALIBRATION_MIN_GAMES}: calibration opens
        </span>
        <span>
          <i className="bg-ink-2" />
          Game {SMALL_SAMPLE_GAMES}: market comparison
        </span>
      </div>
    </div>
  );
}

function BrierBar({ brier, lost }: { brier: number; lost: boolean }) {
  const width = `${brierShare(brier) * 100}%`;
  return (
    <span aria-hidden className="block h-3 w-full">
      <span
        className={`block h-full ${lost ? "bg-white shadow-[inset_0_0_0_2px_#111111]" : "bg-ink"}`}
        style={{ width, minWidth: 2 }}
      />
    </span>
  );
}

function Tags({ game }: { game: ScoredGame }) {
  const tags: string[] = [];
  if (game.noFinalSeal) tags.push(game.seal.sealKind === "reissued" ? "No final seal: reissued seal scored" : "No final seal: morning seal scored");
  if (game.seal.inputsIncomplete) tags.push("Incomplete inputs");
  if (game.seal.availabilityMissing) tags.push("No report");
  else if (game.seal.availabilityStale) tags.push("Stale report");
  if (tags.length === 0) return null;
  return <span className="mt-1 block text-[12px] font-semibold text-warn">{tags.join(" · ")}</span>;
}

/**
 * Every scored seal of one version, by ET date: the game, the sealed pick as a tile,
 * the result (grey when the favorite lost) and the Brier score with its bar. Outline:
 * the favorite lost.
 */
export function ScoredSeals({ games, caption }: { games: ScoredGame[]; caption: string }) {
  const groups = scoredByDate(games);
  return (
    <div className="table-scroll">
      <table className="tb">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Game</th>
            <th scope="col">Sealed</th>
            <th scope="col" className="hidden sm:table-cell">Result</th>
            <th scope="col" className="nm">Brier</th>
            <th scope="col" className="w-[72px] sm:w-[180px] lg:w-[220px]">
              <span className="sr-only">Brier bar</span>
            </th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.etDate}>
            <tr>
              <th colSpan={5} scope="colgroup" className="!pb-2 !pt-6 text-left !text-[13px] !font-bold">
                {formatWeekday(group.etDate)} {formatShortDay(group.etDate)}
              </th>
            </tr>
            {group.games.map((game) => {
              const { home, away } = splitPercents(game.seal.homeWinProbability);
              const favorite = teamDisplay(home >= away ? game.seal.homeId : game.seal.awayId).code;
              const winner = teamDisplay(game.homeWon ? game.seal.homeId : game.seal.awayId).code;
              const high = Math.max(game.result.homeScore, game.result.awayScore);
              const low = Math.min(game.result.homeScore, game.result.awayScore);
              const lost = favoriteLost(game);
              const result = `${winner} ${high}–${low}`;
              return (
                <tr key={game.seal.gameId} className="hover:bg-wash">
                  <th scope="row" className="relative text-left font-normal">
                    <CellLink gameId={game.seal.gameId} />
                    <Matchup awayId={game.seal.awayId} homeId={game.seal.homeId} />
                    <span className={`mt-0.5 block text-[12.5px] sm:hidden ${lost ? "text-ink-2" : ""}`}>{result}</span>
                    <Tags game={game} />
                  </th>
                  <td className="relative">
                    <Link
                      href={gameHref(game.seal.gameId)}
                      aria-label={`${gameLabel(game.seal.awayId, game.seal.homeId, group.etDate)}. Sealed ${home === away ? "even" : `${favorite} ${Math.max(home, away)}%`}, ${result}.`}
                      className="inline-block after:absolute after:inset-0"
                    >
                      <Tile size="xs" className="min-w-[56px] !text-[13px] [--t:24px]">
                        {home === away ? "Even" : `${favorite} ${Math.max(home, away)}%`}
                      </Tile>
                    </Link>
                  </td>
                  <td className={`relative hidden whitespace-nowrap sm:table-cell ${lost ? "!text-ink-2" : ""}`}>
                    {result}
                    <CellLink gameId={game.seal.gameId} />
                  </td>
                  <td className="nm num relative">
                    {game.brier.toFixed(3)}
                    <CellLink gameId={game.seal.gameId} />
                  </td>
                  <td className="relative">
                    <BrierBar brier={game.brier} lost={lost} />
                    <CellLink gameId={game.seal.gameId} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** One version's missed seals, or a line saying there are none. */
export function MissedSeals({ missed, version }: { missed: MissedRow[]; version: string }) {
  if (missed.length === 0) {
    return (
      <p className="text-[13px] text-ink-2">
        No missed seals for <span className="num">{version}</span>: every game it should have sealed was sealed before tip.
      </p>
    );
  }
  return (
    <ul className="grid gap-1.5 text-[13px] sm:grid-cols-2">
      {missed.map((row) => (
        <li key={`${row.gameId}-${row.etDate}`} className="flex items-center gap-2">
          <Link
            href={gameHref(row.gameId)}
            aria-label={gameLabel(row.awayId, row.homeId, row.etDate)}
            className="inline-flex min-h-6 items-center gap-2 hover:underline hover:underline-offset-4"
          >
            <span className="font-bold text-bad">Missed</span>
            <span className="text-ink-2">{formatShortDay(row.etDate)}</span>
          </Link>
          <Matchup awayId={row.awayId} homeId={row.homeId} />
        </li>
      ))}
    </ul>
  );
}

/** The empty calibration square: only the dashed diagonal, until 100 scored games. */
export function CalibrationPlaceholder() {
  return (
    <div>
      <div className="relative mt-4 aspect-square w-full max-w-[200px] shadow-[inset_0_0_0_1px_var(--chart-track)]">
        <svg viewBox="0 0 200 200" className="block h-full w-full" aria-hidden>
          <line x1={0} y1={200} x2={200} y2={0} stroke="var(--chart-ink)" strokeWidth={1.5} strokeDasharray="5 4" />
        </svg>
      </div>
      <p className="mt-2 text-[13px] text-ink-2">Dashed: perfectly calibrated</p>
    </div>
  );
}

/** Ten bins of the home win probability against the home win rate, ink on grey. */
export function CalibrationChart({ bins }: { bins: CalibrationBin[] }) {
  const size = 300;
  const pad = 34;
  const scale = (value: number) => pad + value * (size - 2 * pad);
  const flip = (value: number) => size - scale(value);
  const maxCount = Math.max(...bins.map((bin) => bin.count));
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="mt-4 h-auto w-full max-w-[300px]"
      role="img"
      aria-label={`Calibration: ${bins
        .map((bin) => `forecasts near ${Math.round(bin.forecast * 100)}% came true ${Math.round(bin.observed * 100)}% of the time (${bin.count} games)`)
        .join("; ")}.`}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
        <g key={tick}>
          <line x1={scale(0)} x2={scale(1)} y1={flip(tick)} y2={flip(tick)} stroke="var(--chart-grid)" />
          <text x={pad - 6} y={flip(tick)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--chart-text)">
            {tick * 100}%
          </text>
          <text x={scale(tick)} y={size - pad + 16} textAnchor="middle" fontSize={10} fill="var(--chart-text)">
            {tick * 100}%
          </text>
        </g>
      ))}
      <line x1={scale(0)} y1={flip(0)} x2={scale(1)} y2={flip(1)} stroke="var(--chart-ink)" strokeWidth={1.5} strokeDasharray="5 4" />
      {bins.map((bin) => (
        <rect
          key={bin.from}
          x={scale(bin.forecast) - (4 + 5 * Math.sqrt(bin.count / maxCount))}
          y={flip(bin.observed) - (4 + 5 * Math.sqrt(bin.count / maxCount))}
          width={2 * (4 + 5 * Math.sqrt(bin.count / maxCount))}
          height={2 * (4 + 5 * Math.sqrt(bin.count / maxCount))}
          fill="var(--chart-ink)"
        >
          <title>{`${Math.round(bin.from * 100)}–${Math.round(bin.to * 100)}%: forecast ${Math.round(bin.forecast * 100)}%, home team won ${Math.round(bin.observed * 100)}% (${bin.count} games)`}</title>
        </rect>
      ))}
    </svg>
  );
}
