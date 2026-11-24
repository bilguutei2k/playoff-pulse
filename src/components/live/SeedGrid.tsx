"use client";

import { TableScroll } from "@/components/layout/TableScroll";
import { TeamLink } from "@/components/live/TeamLink";
import { useQueryState } from "@/components/live/useQueryState";
import { ODDS_DEFAULT, parseOddsQuery, serializeOddsQuery } from "@/app/odds/query";
import { SEED_BANDS, seedCellText, seedShade, type SeedGrid as Grid } from "@/lib/view/seed-grid";

/**
 * Where each team finishes: one table per conference, teams down the side in order of
 * expected seed, seeds 1 to 15 across in three labelled bands. A cell's grey carries the
 * published chance and prints it as a whole percent from 1%; under 1% but above zero
 * shows a small mark, zero shows nothing (screen readers hear "under 1%" and "none").
 * Every number is printed, so nothing needs hover. It follows the odds table's
 * conference tab through the shared URL query (East, West or both).
 */
export function SeedGrid({
  grids,
  exact,
}: {
  grids: Grid[];
  /** Past the regular season, 0% and 100% are facts and print as such. */
  exact: boolean;
}) {
  const [query] = useQueryState(ODDS_DEFAULT, parseOddsQuery, serializeOddsQuery);
  const shown = query.view === "League" ? grids : grids.filter((grid) => grid.conference === query.view);
  return (
    <div className="grid gap-y-10">
      {shown.map((grid) => (
        <ConferenceGrid key={grid.conference} grid={grid} exact={exact} titled={shown.length > 1} />
      ))}
    </div>
  );
}

function ConferenceGrid({ grid, exact, titled }: { grid: Grid; exact: boolean; titled: boolean }) {
  const name = `${grid.conference}ern Conference`;
  const count = grid.rows[0]?.seeds.length ?? 15;
  const bands = SEED_BANDS.filter((band) => band.from <= count);
  return (
    <div>
      {titled ? <h3 className="mb-2 text-[15px] font-bold">{name}</h3> : null}
      <TableScroll label={`${name} seed chances`}>
        <table className="tb seed-table">
          <caption className="sr-only">
            {name}: chance of each seed when the regular season ends, in percent. Seeds 1 to 6 reach the playoffs, 7 to
            10 the play-in, 11 to 15 are out.
          </caption>
          <colgroup>
            <col className="seed-team-col" />
          </colgroup>
          {bands.map((band) => (
            <colgroup key={band.label} span={Math.min(band.to, count) - band.from + 1} />
          ))}
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="seed-corner">
                Team
              </th>
              {bands.map((band) => (
                <th
                  key={band.label}
                  scope="colgroup"
                  colSpan={Math.min(band.to, count) - band.from + 1}
                  className={`seed-band ${band.from > 1 ? "seed-gap" : ""}`}
                >
                  {band.label}
                </th>
              ))}
            </tr>
            <tr>
              {Array.from({ length: count }, (_, index) => (
                <th
                  key={index}
                  scope="col"
                  className={`seed-num num ${bands.some((band) => band.from > 1 && band.from === index + 1) ? "seed-gap" : ""}`}
                >
                  <span className="sr-only">Seed </span>
                  {index + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.teamId}>
                <th scope="row" className="seed-team">
                  <TeamLink teamId={row.teamId} form={{ base: "code", lg: "short" }} logo={16} className="font-bold" />
                </th>
                {row.seeds.map((probability, index) => {
                  const text = seedCellText(probability, exact);
                  const gap = bands.some((band) => band.from > 1 && band.from === index + 1);
                  return (
                    <td key={index} className={`seed-cell seed-s${text === null ? 0 : seedShade(probability)} ${gap ? "seed-gap" : ""}`}>
                      {text !== null ? (
                        <>
                          {text}
                          <span className="sr-only">%</span>
                        </>
                      ) : probability > 0 ? (
                        <>
                          <i aria-hidden className="seed-mark" />
                          <span className="sr-only">under 1%</span>
                        </>
                      ) : (
                        <span className="sr-only">none</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}
