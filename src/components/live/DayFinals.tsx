import Link from "next/link";
import { Hint } from "@/components/live/Hint";
import { TeamLink } from "@/components/live/TeamLink";
import { Tile } from "@/components/live/Tile";
import { cardClock } from "@/lib/view/bracket";
import type { DaySummary, FinalRow } from "@/lib/view/day-summary";
import { gameHref, teamHref } from "@/lib/view/routes";
import { pairColors, teamDisplay } from "@/lib/view/teams";

const CHART_HEIGHT = 150;
const CHART_LEFT = 28;
const CHART_FLOOR = 128;
const CHART_TOP = 18;
/** Where the code labels under the bars start. */
const LABEL_TOP = 132;

const chartY = (percent: number) => CHART_FLOOR - ((percent - 50) / 50) * (CHART_FLOOR - CHART_TOP);

/** How the chart's percent reads for a row: the favorite's chance, 50 for an even seal. */
const rowPercent = (row: FinalRow) => row.favorite?.percent ?? 50;

/**
 * The bars themselves, drawn at a fixed width so labels stay legible at both sizes.
 * Each bar opens its game and each code its team, through HTML links laid over the
 * drawing (SVG cannot hold Next links). They are pointer conveniences only, hidden
 * from the keyboard and screen readers: the Final table below links every game and
 * team, and the figure's text summary stays the accessible reading.
 */
function FinalsBars({ rows, width }: { rows: FinalRow[]; width: number }) {
  const slot = (width - CHART_LEFT) / rows.length;
  const bar = Math.min(34, slot * 0.78);
  const labels = slot >= 22;
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${CHART_HEIGHT}`} className="block h-auto w-full" aria-hidden>
        {[50, 75, 100].map((tick) => (
          <g key={tick}>
            <line
              x1={CHART_LEFT - 2}
              x2={width}
              y1={chartY(tick)}
              y2={chartY(tick)}
              stroke={tick === 50 ? "var(--chart-axis)" : "var(--chart-track)"}
            />
            <text x={0} y={chartY(tick) + 4} fontSize={11} fill="var(--chart-text)">
              {tick}%
            </text>
          </g>
        ))}
        {rows.map((row, index) => {
          const x = CHART_LEFT + index * slot + (slot - bar) / 2;
          if (row.even) {
            // No favorite: a short grey tick on the 50% line, labelled "Even".
            return (
              <g key={row.game.id}>
                <rect x={x} y={CHART_FLOOR - 4} width={bar} height={4} fill="var(--chart-mid)" />
                <text x={x + bar / 2} y={CHART_FLOOR - 10} fontSize={11} fontWeight={700} fill="var(--chart-text)" textAnchor="middle">
                  Even
                </text>
              </g>
            );
          }
          const percent = rowPercent(row);
          const lost = row.upset === true;
          return (
            <g key={row.game.id}>
              {lost ? (
                <rect
                  x={x + 1}
                  y={chartY(percent)}
                  width={bar - 2}
                  height={CHART_FLOOR - chartY(percent)}
                  fill="var(--chart-surface)"
                  stroke="var(--chart-ink)"
                  strokeWidth={2}
                />
              ) : (
                <rect x={x} y={chartY(percent)} width={bar} height={CHART_FLOOR - chartY(percent)} fill="var(--chart-ink)" />
              )}
              <text x={x + bar / 2} y={chartY(percent) - 6} fontSize={11} fontWeight={700} fill="var(--chart-ink)" textAnchor="middle">
                {percent}
              </text>
              {labels ? (
                <text x={x + bar / 2} y={143} fontSize={10.5} fill="var(--chart-text)" textAnchor="middle">
                  {row.favorite!.code}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {rows.map((row, index) => {
        const left = pct(CHART_LEFT + index * slot, width);
        const slotWidth = pct(slot, width);
        const top = row.even ? CHART_FLOOR - 24 : chartY(rowPercent(row)) - 18;
        return (
          <span key={row.game.id} aria-hidden>
            <Link
              href={gameHref(row.game.id)}
              tabIndex={-1}
              className="absolute hover:bg-ink/5"
              style={{ left, width: slotWidth, top: pct(top, CHART_HEIGHT), height: pct(CHART_FLOOR - top, CHART_HEIGHT) }}
            />
            {labels && row.favorite ? (
              <Link
                href={teamHref(row.favorite.teamId)}
                tabIndex={-1}
                className="absolute hover:bg-ink/5"
                style={{ left, width: slotWidth, top: pct(LABEL_TOP, CHART_HEIGHT), bottom: 0 }}
              />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Each scored final as a bar of 548's sealed chance for its favorite, lowest first.
 * Solid: the favorite won. Outline: it lost. A grey tick: an even seal, no favorite.
 * The axis runs from 50% to 100%. Won and expected count the same games.
 */
export function FinalsChart({ summary, title }: { summary: DaySummary; title: string }) {
  const scored = [...summary.scored].sort(
    (a, b) => rowPercent(a) - rowPercent(b) || a.game.tipUtc.localeCompare(b.game.tipUtc),
  );
  if (scored.length === 0) return null;
  const description = scored
    .map((row) => {
      const away = teamDisplay(row.game.awayId).code;
      const home = teamDisplay(row.game.homeId).code;
      return row.favorite
        ? `${row.favorite.code} ${row.favorite.percent}%, ${row.upset ? "lost" : "won"}`
        : `${away} at ${home} even`;
    })
    .join("; ");
  return (
    <figure>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[16px] font-bold">{title}</h2>
        {summary.decided > 0 ? (
          <p className="text-[13px]">
            <b>{summary.favoritesWon}</b> <span className="text-ink-2">of</span> <b>{summary.decided}</b>{" "}
            <span className="text-ink-2">favorites won ·</span> <b>{summary.expected.toFixed(1)}</b>{" "}
            <span className="text-ink-2">expected{summary.even > 0 ? ` · ${summary.even} even` : ""}</span>
          </p>
        ) : (
          <p className="text-[13px] text-ink-2">No favorite: {summary.even === 1 ? "an even seal" : "even seals"}</p>
        )}
      </div>
      <div role="img" aria-label={`548's sealed chance for each favorite: ${description}.`}>
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

/** Brier on a scale where 0.5 fills the cell and the tick marks a coin flip (0.25). */
const BRIER_FULL = 0.5;

function BrierBar({ value, lost }: { value: number; lost: boolean }) {
  const width = `${Math.min(100, (value / BRIER_FULL) * 100)}%`;
  return (
    <span aria-hidden className="relative block h-2.5 w-full bg-wash">
      <span
        className={`absolute inset-y-0 left-0 ${lost ? "border-2 border-ink bg-panel" : "bg-ink"}`}
        style={{ width, minWidth: 2 }}
      />
      <span className="absolute -bottom-1 -top-1 left-1/2 w-px bg-ink-2" />
    </span>
  );
}

function SplitCell({ row }: { row: FinalRow }) {
  if (!row.percents) return <span className="text-[13px] text-ink-2">{row.game.missed ? "Missed: no seal" : row.game.beforeRecord ? "Not in the record" : "No seal"}</span>;
  const [awayColor, homeColor] = pairColors(row.game.awayId, row.game.homeId);
  return (
    <span className="block">
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
  return <Link href={gameHref(gameId)} aria-hidden tabIndex={-1} className="absolute inset-0" />;
}

/** A team line of the Final cell, and its score beside it: one fixed height so the two columns line up. */
const teamClass = (won: boolean) => `h-6 ${won ? "font-bold" : "text-ink-2"}`;

/**
 * The day's finals in tip order: both teams and the score, each side's sealed chance
 * in team colors, 548's favorite, and the game's Brier score. Outline: the favorite
 * lost. Teams link to their pages; the score, and the rest of each row, to the game.
 * `home` hides the Brier column while the home page's sidebar leaves the table narrow.
 */
export function FinalsTable({ rows, home = false }: { rows: FinalRow[]; home?: boolean }) {
  const brierCell = `hidden md:table-cell ${home ? "lg:hidden xl:table-cell" : ""}`;
  return (
    <div className="table-scroll">
      <table className="tb min-w-0">
        <caption className="sr-only">
          Final scores with 548&apos;s sealed chance for each side, its favorite and the Brier score of each game. Lower Brier is better.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="hidden w-[88px] sm:table-cell">Tip</th>
            <th scope="col" className="w-[104px] sm:w-[150px] xl:w-[200px]">Final</th>
            <th scope="col">
              <span className="hidden sm:inline">Each side, sealed</span>
              <span className="sm:hidden">548 sealed</span>
            </th>
            <th scope="col" className="nm sm:w-[96px] sm:text-left">Favorite</th>
            <th scope="col" className={`w-[160px] ${brierCell}`}>
              <Hint term="Brier" label="Brier score">
                The squared error of the sealed chance: 0 is perfect, lower is better. A coin flip scores 0.250, the tick in
                each bar.
              </Hint>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { game } = row;
            const overtime = /OT/i.test(game.statusDetail) ? game.statusDetail.replace(/^Final\s*\/?\s*/i, "") : null;
            const away = teamDisplay(game.awayId);
            const home = teamDisplay(game.homeId);
            return (
              <tr key={game.id} className="hover:bg-wash">
                <td className="relative hidden align-middle text-[13px] text-ink-2 sm:table-cell">
                  {cardClock(game.tipUtc)}
                  {overtime ? <span className="block">{overtime}</span> : null}
                  <CellLink gameId={game.id} />
                </td>
                <th scope="row" className="relative text-left font-normal">
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 flex-col">
                      <TeamLink teamId={game.awayId} form={{ base: "code", xl: "short" }} logo={18} raised className={teamClass(!row.homeWon)} />
                      <TeamLink teamId={game.homeId} form={{ base: "code", xl: "short" }} logo={18} raised className={teamClass(row.homeWon)} />
                    </span>
                    <Link
                      href={gameHref(game.id)}
                      className="num flex flex-none flex-col text-right after:absolute after:inset-0"
                      aria-label={`${away.shortName} ${game.awayScore}, ${home.shortName} ${game.homeScore}: game details`}
                    >
                      <span className={teamClass(!row.homeWon)}>{game.awayScore}</span>
                      <span className={teamClass(row.homeWon)}>{game.homeScore}</span>
                    </Link>
                  </span>
                </th>
                <td className="relative min-w-[88px] sm:min-w-[120px] sm:pr-6 lg:pr-10">
                  <SplitCell row={row} />
                  <span className="mt-1 block text-[12.5px] text-ink-2 sm:hidden">
                    {cardClock(game.tipUtc)}
                    {overtime ? ` · ${overtime}` : ""}
                  </span>
                  <CellLink gameId={game.id} />
                </td>
                <td className="nm relative sm:text-left">
                  {row.favorite ? (
                    <Tile size="xs" className="!text-[13px]">
                      {row.favorite.code} {row.favorite.percent}%
                    </Tile>
                  ) : (
                    <span className="text-[13px] text-ink-2">{row.even ? "Even" : "–"}</span>
                  )}
                  {row.upset ? <span className="mt-1 block text-[13px] font-bold">Upset</span> : null}
                  <CellLink gameId={game.id} />
                </td>
                <td className={`relative ${brierCell}`}>
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
