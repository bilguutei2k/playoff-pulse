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
  onTeamSelect?: (teamId: string) => void;
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

function ProbabilityCell({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="pp-heat pp-heat-zero">n/a</span>;
  }

  return (
    <span className={`pp-heat ${heatClass(value)}`}>
      {formatPercent(value)}
    </span>
  );
}

export function ProbabilityTable({
  seriesForecasts,
  bracketForecast,
  teamsById,
  onTeamSelect,
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
              <th className="num">Reached CF</th>
              <th className="num">Made Finals</th>
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
              const eliminatedFromTitlePath =
                !seriesRow &&
                bracketRow.reachFinalsProbability === 0 &&
                bracketRow.championshipProbability === 0;
              const muted =
                bracketRow.championshipProbability === 0 &&
                bracketRow.reachFinalsProbability === 0;

              return (
                <tr
                  key={bracketRow.teamId}
                  className={`${muted ? "opacity-60" : ""} ${
                    onTeamSelect ? "cursor-pointer" : ""
                  }`}
                  tabIndex={onTeamSelect ? 0 : undefined}
                  onClick={() => onTeamSelect?.(bracketRow.teamId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onTeamSelect?.(bracketRow.teamId);
                    }
                  }}
                >
                  <td>
                    {seriesRow?.series ??
                      (eliminatedFromTitlePath ? "Eliminated" : "Future path")}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-[var(--radius-sm-retro)] p-1 text-left transition hover:bg-[var(--overlay-row-hover)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
                      onClick={(event) => {
                        event.stopPropagation();
                        onTeamSelect?.(bracketRow.teamId);
                      }}
                    >
                      <span className="pp-team-badge" data-team={team.abbreviation}>
                        {team.abbreviation}
                      </span>
                      <span className="font-bold text-[var(--color-text-primary)]">
                        {team.name}
                      </span>
                    </button>
                  </td>
                  <td className="num pp-number font-bold">
                    {seriesRow ? (
                      <ProbabilityCell value={seriesRow.probability} />
                    ) : eliminatedFromTitlePath ? (
                      <span className="pp-heat pp-heat-zero">Eliminated</span>
                    ) : (
                      <span className="pp-heat pp-heat-zero">n/a</span>
                    )}
                  </td>
                  <td className="num pp-number">
                    <ProbabilityCell
                      value={
                        eliminatedFromTitlePath
                          ? null
                          : bracketRow.reachConferenceFinalsProbability
                      }
                    />
                  </td>
                  <td className="num pp-number">
                    <ProbabilityCell
                      value={
                        eliminatedFromTitlePath
                          ? null
                          : bracketRow.reachFinalsProbability
                      }
                    />
                  </td>
                  <td className="num pp-number font-bold">
                    <ProbabilityCell value={bracketRow.championshipProbability} />
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
