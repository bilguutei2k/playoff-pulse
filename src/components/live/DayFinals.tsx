import Link from "next/link";
import { TeamLogo } from "@/components/live/TeamLogo";
import { Tile } from "@/components/live/Tile";
import { cardClock } from "@/lib/view/bracket";
import type { FinalRow } from "@/lib/view/day-summary";
import { pairColors, teamDisplay } from "@/lib/view/teams";

/** The bars themselves, drawn at a fixed width so labels stay legible at both sizes. */
function FinalsBars({ rows, width }: { rows: FinalRow[]; width: number }) {
  const height = 150;
  const left = 28;
  const floor = 128;
  const top = 18;
  const y = (percent: number) => floor - ((percent - 50) / 50) * (floor - top);
  const slot = (width - left) / rows.length;
  const bar = Math.min(34, slot * 0.78);
  const labels = slot >= 22;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" aria-hidden>
      {[50, 75, 100].map((tick) => (
        <g key={tick}>
          <line x1={left - 2} x2={width} y1={y(tick)} y2={y(tick)} stroke={tick === 50 ? "#111111" : "#dcdcdc"} />
          <text x={0} y={y(tick) + 4} fontSize={11} fill="#666666">
            {tick}%
          </text>
        </g>
      ))}
      {rows.map((row, index) => {
        const x = left + index * slot + (slot - bar) / 2;
        const percent = row.pick!.percent;
        const lost = row.upset === true;
        return (
          <g key={row.game.id}>
            {lost ? (
              <rect x={x + 1} y={y(percent)} width={bar - 2} height={floor - y(percent)} fill="#ffffff" stroke="#111111" strokeWidth={2} />
            ) : (
              <rect x={x} y={y(percent)} width={bar} height={floor - y(percent)} fill="#111111" />
            )}
            <text x={x + bar / 2} y={y(percent) - 6} fontSize={11} fontWeight={700} fill="#111111" textAnchor="middle">
              {percent}
            </text>
            {labels ? (
              <text x={x + bar / 2} y={143} fontSize={10.5} fill="#666666" textAnchor="middle">
                {row.pick!.code}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Each scored final as a bar of 548's sealed chance for its favorite, lowest first.
 * Solid: the favorite won. Outline: it lost. The axis runs from 50% to 100%.
 */
export function FinalsChart({ rows, title }: { rows: FinalRow[]; title: string }) {
  const scored = rows
    .filter((row) => row.pick !== null)
    .sort((a, b) => a.pick!.percent - b.pick!.percent || a.game.tipUtc.localeCompare(b.game.tipUtc));
  if (scored.length === 0) return null;
  const won = scored.filter((row) => row.upset === false).length;
  const expected = scored.reduce((sum, row) => {
    const p = row.game.forecast!.homeWinProbability;
    return sum + Math.max(p, 1 - p);
  }, 0);
  const summary = scored
    .map((row) => `${row.pick!.code} ${row.pick!.percent}%, ${row.upset ? "lost" : row.upset === false ? "won" : "even"}`)
    .join("; ");
  return (
    <figure>
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <h2 className="text-[16px] font-bold">{title}</h2>
        <p className="text-[13px]">
          <b>{won}</b> <span className="text-ink-2">favorites won ·</span> <b>{expected.toFixed(1)}</b>{" "}
          <span className="text-ink-2">expected</span>
        </p>
      </div>
      <div role="img" aria-label={`548's sealed chance for each favorite: ${summary}.`}>
        <div className="sm:hidden">
          <FinalsBars rows={scored} width={360} />
        </div>
        <div className="hidden sm:block">
          <FinalsBars rows={scored} width={560} />
        </div>
      </div>
      <figcaption className="legend mt-0.5">
        <span>
          <i className="bg-ink" />
          Favorite won
        </span>
        <span>
          <i className="shadow-[inset_0_0_0_2px_#111111]" />
          Favorite lost
        </span>
        <span>Height: 548&apos;s sealed chance for the favorite</span>
      </figcaption>
    </figure>
  );
}

function BrierBar({ value, lost }: { value: number; lost: boolean }) {
  // 0.75 fills the cell: a 13% favorite that loses scores about that.
  const width = `${Math.min(100, (value / 0.75) * 100)}%`;
  return (
    <span aria-hidden className="relative block h-2.5 w-full">
      <span
        className={`absolute inset-y-0 left-0 ${lost ? "border-2 border-ink" : "bg-ink"}`}
        style={{ width, minWidth: 2 }}
      />
    </span>
  );
}

function TeamCell({ teamId, score, won }: { teamId: string; score: number; won: boolean }) {
  return (
    <span className={`grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 ${won ? "font-bold" : "text-ink-2"}`}>
      <TeamLogo teamId={teamId} size={18} />
      <span>{teamDisplay(teamId).code}</span>
      <span className="num w-9 text-right">{score}</span>
    </span>
  );
}

function SplitCell({ row }: { row: FinalRow }) {
  if (!row.percents) return <span className="text-[13px] text-ink-2">{row.game.missed ? "Missed: no seal" : row.game.beforeRecord ? "Not in the record" : "No seal"}</span>;
  const [awayColor, homeColor] = pairColors(row.game.awayId, row.game.homeId);
  return (
    <span className="block max-w-[340px]">
      <span className="num flex justify-between text-[12.5px]">
        <span>{row.percents.away}%</span>
        <span>{row.percents.home}%</span>
      </span>
      <span aria-hidden className="mt-1 flex h-2.5 gap-0.5">
        <span style={{ width: `${row.percents.away}%`, background: awayColor }} />
        <span className="flex-1" style={{ background: homeColor }} />
      </span>
    </span>
  );
}

/**
 * Makes the rest of a row's cell open the game too. The real link is the score cell's;
 * this copy is hidden from the keyboard and screen readers. Each cell holds its own
 * cover because a table row cannot be trusted to contain one: where a browser ignores
 * `position: relative` on a `<tr>` (Safari 26 does), a row-wide cover stretches over
 * the top of the page and takes the clicks meant for the days row.
 */
function CellLink({ gameId }: { gameId: string }) {
  return <Link href={`/game/${gameId}`} aria-hidden tabIndex={-1} className="absolute inset-0" />;
}

/**
 * The day's finals in tip order: both teams and the score, each side's sealed chance
 * in team colors, 548's pick, and the game's Brier score. Outline: the pick lost.
 */
export function FinalsTable({ rows }: { rows: FinalRow[] }) {
  return (
    <div className="table-scroll">
      <table className="tb min-w-0">
        <caption className="sr-only">
          Final scores with 548&apos;s sealed chance for each side, its pick and the Brier score of each game. Lower Brier is better.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="hidden w-[88px] sm:table-cell">Tip</th>
            <th scope="col" className="w-[120px] sm:w-[150px]">Final</th>
            <th scope="col">
              <span className="hidden sm:inline">Each side, sealed</span>
              <span className="sm:hidden">548 sealed</span>
            </th>
            <th scope="col" className="nm sm:text-left">Pick</th>
            <th scope="col" className="hidden w-[64px] md:table-cell">
              <span className="sr-only">Upset</span>
            </th>
            <th scope="col" className="hidden w-[150px] md:table-cell">Brier</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { game } = row;
            const overtime = /OT/i.test(game.statusDetail) ? game.statusDetail.replace(/^Final\s*\/?\s*/i, "") : null;
            return (
              <tr key={game.id} className="hover:bg-wash">
                <td className="relative hidden align-middle text-[13px] text-ink-2 sm:table-cell">
                  {cardClock(game.tipUtc)}
                  {overtime ? <span className="block">{overtime}</span> : null}
                  <CellLink gameId={game.id} />
                </td>
                <th scope="row" className="relative text-left">
                  <Link href={`/game/${game.id}`} className="grid gap-0.5 after:absolute after:inset-0" aria-label={`${teamDisplay(game.awayId).shortName} ${game.awayScore}, ${teamDisplay(game.homeId).shortName} ${game.homeScore}: game details`}>
                    <TeamCell teamId={game.awayId} score={game.awayScore!} won={!row.homeWon} />
                    <TeamCell teamId={game.homeId} score={game.homeScore!} won={row.homeWon} />
                  </Link>
                </th>
                <td className="relative min-w-[120px] sm:pr-6 lg:pr-16">
                  <SplitCell row={row} />
                  <span className="mt-1 block text-[12.5px] text-ink-2 sm:hidden">
                    {cardClock(game.tipUtc)}
                    {overtime ? ` · ${overtime}` : ""}
                  </span>
                  <CellLink gameId={game.id} />
                </td>
                <td className="nm relative sm:text-left">
                  {row.pick ? (
                    <Tile size="xs" className="!text-[13px]">
                      {row.pick.code} {row.pick.percent}%
                    </Tile>
                  ) : (
                    <span className="text-[13px] text-ink-2">–</span>
                  )}
                  {row.upset ? <span className="mt-1 block text-[13px] font-bold md:hidden">Upset</span> : null}
                  <CellLink gameId={game.id} />
                </td>
                <td className="relative hidden text-[13px] font-bold md:table-cell">
                  {row.upset ? "Upset" : ""}
                  <CellLink gameId={game.id} />
                </td>
                <td className="relative hidden md:table-cell">
                  {row.brier !== null ? (
                    <span className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-3">
                      <span className="num text-right text-[13px]">{row.brier.toFixed(3)}</span>
                      <BrierBar value={row.brier} lost={row.upset === true} />
                    </span>
                  ) : (
                    <span className="text-[13px] text-ink-2">–</span>
                  )}
                  <CellLink gameId={game.id} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
