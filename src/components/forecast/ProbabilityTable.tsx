import type {
  BracketForecast,
  SeriesForecast,
  Team,
} from "@/lib/model/types";
import { formatNumber, formatPercent } from "@/lib/utils/format";

type ProbabilityTableProps = {
  seriesForecasts: SeriesForecast[];
  bracketForecast: BracketForecast;
  teamsById: Record<string, Team>;
};

function heatClass(value: number): string {
  if (value >= 0.3) {
    return "pp-heat-high";
  }

  if (value >= 0.1) {
    return "pp-heat-mid";
  }

  if (value > 0) {
    return "pp-heat-low";
  }

  return "pp-heat-zero";
}

export function ProbabilityTable({
  seriesForecasts,
  bracketForecast,
  teamsById,
}: ProbabilityTableProps) {
  const currentSeriesRows = seriesForecasts
    .filter((forecast) => forecast.winsA < 4 && forecast.winsB < 4)
    .flatMap((forecast) => {
      const teamA = teamsById[forecast.teamAId];
      const teamB = teamsById[forecast.teamBId];

      return [
        {
          teamId: teamA.id,
          series: `${teamA.abbreviation} vs ${teamB.abbreviation}`,
          probability: forecast.teamASeriesWinProbability,
          games: forecast.expectedGamesRemaining,
        },
        {
          teamId: teamB.id,
          series: `${teamA.abbreviation} vs ${teamB.abbreviation}`,
          probability: forecast.teamBSeriesWinProbability,
          games: forecast.expectedGamesRemaining,
        },
      ];
    });

  return (
    <>
      <div className="overflow-x-auto">
        <table className="pp-table min-w-[980px]">
          <thead>
            <tr>
              <th>Series</th>
              <th>Team</th>
              <th className="num">Current series</th>
              <th className="num">Conf finals</th>
              <th className="num">Finals</th>
              <th className="num">Champ</th>
              <th className="num">Games left</th>
            </tr>
          </thead>
          <tbody>
            {bracketForecast.rows.map((bracketRow) => {
              const team = teamsById[bracketRow.teamId];
              const seriesRow = currentSeriesRows.find(
                (row) => row.teamId === bracketRow.teamId,
              );
              const muted =
                bracketRow.championshipProbability === 0 &&
                bracketRow.reachFinalsProbability === 0;

              return (
                <tr key={bracketRow.teamId} className={muted ? "opacity-60" : ""}>
                  <td>{seriesRow?.series ?? "Future path"}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="pp-team-badge" data-team={team.abbreviation}>
                        {team.abbreviation}
                      </span>
                      <span className="font-bold text-[var(--color-text-primary)]">
                        {team.name}
                      </span>
                    </div>
                  </td>
                  <td className="num pp-number font-bold">
                    {seriesRow ? (
                      <span className={`pp-heat ${heatClass(seriesRow.probability)}`}>
                        {formatPercent(seriesRow.probability)}
                      </span>
                    ) : (
                      <span className="pp-heat pp-heat-zero">n/a</span>
                    )}
                  </td>
                  <td className="num pp-number">
                    <span
                      className={`pp-heat ${heatClass(
                        bracketRow.reachConferenceFinalsProbability,
                      )}`}
                    >
                      {formatPercent(bracketRow.reachConferenceFinalsProbability)}
                    </span>
                  </td>
                  <td className="num pp-number">
                    <span
                      className={`pp-heat ${heatClass(bracketRow.reachFinalsProbability)}`}
                    >
                      {formatPercent(bracketRow.reachFinalsProbability)}
                    </span>
                  </td>
                  <td className="num pp-number font-bold">
                    <span
                      className={`pp-heat ${heatClass(bracketRow.championshipProbability)}`}
                    >
                      {formatPercent(bracketRow.championshipProbability)}
                    </span>
                  </td>
                  <td className="num pp-number">
                    {seriesRow ? formatNumber(seriesRow.games) : "n/a"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t-2 border-[var(--color-border-subtle)] bg-[var(--color-panel-secondary)] px-4 py-3 text-xs leading-5 text-[var(--color-text-muted)]">
        Bracket coverage:{" "}
        {bracketForecast.structurallyComplete
          ? "structurally complete manual input"
          : "incomplete manual input"}
        . Bracket simulation: {bracketForecast.iterations.toLocaleString()} runs.
        Title probabilities sum to {formatPercent(bracketForecast.titleProbabilityTotal)}.
        {bracketForecast.notes.length ? ` ${bracketForecast.notes.join(" ")}` : ""}
      </div>
    </>
  );
}
