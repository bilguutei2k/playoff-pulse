import type { Team, TeamForecast } from "@/lib/model/types";
import { formatNumber, formatSigned } from "@/lib/utils/format";

type TeamStrengthTableProps = {
  teamsById: Record<string, Team>;
  forecasts: TeamForecast[];
  onTeamSelect?: (teamId: string) => void;
};

function heatClass(value: number): string {
  const magnitude = Math.abs(value);

  if (magnitude >= 4) {
    return "pp-heat-high";
  }

  if (magnitude >= 2) {
    return "pp-heat-mid";
  }

  if (magnitude > 0) {
    return "pp-heat-low";
  }

  return "pp-heat-zero";
}

export function TeamStrengthTable({
  teamsById,
  forecasts,
  onTeamSelect,
}: TeamStrengthTableProps) {
  const maxStrength = Math.max(...forecasts.map((forecast) => forecast.finalStrength), 1);

  return (
    <div className="overflow-x-auto">
      <table className="pp-table min-w-[760px]">
        <thead>
          <tr>
            <th>Team</th>
            <th className="num">Player impact</th>
            <th className="num">Net rating</th>
            <th className="num">Elo conv</th>
            <th className="num">Manual</th>
            <th className="num">Strength</th>
            <th>Scale</th>
          </tr>
        </thead>
        <tbody>
          {forecasts.map((forecast) => {
            const team = teamsById[forecast.teamId];
            const scale = Math.max(0, Math.min(1, forecast.finalStrength / maxStrength));

            return (
              <tr
                key={forecast.teamId}
                className={onTeamSelect ? "cursor-pointer" : ""}
                tabIndex={onTeamSelect ? 0 : undefined}
                onClick={() => onTeamSelect?.(forecast.teamId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onTeamSelect?.(forecast.teamId);
                  }
                }}
              >
                <td>
                  <div className="flex items-center gap-2">
                    <span className="pp-team-badge" data-team={team.abbreviation}>
                      {team.abbreviation}
                    </span>
                    <span className="font-bold text-[var(--color-text-primary)]">
                      {team.name}
                    </span>
                    <span className="pp-kicker">
                      {team.conference.slice(0, 1)}{team.seed}
                    </span>
                  </div>
                </td>
                <td className="num pp-number">
                  <span className={`pp-heat ${heatClass(forecast.playerMinuteImpact)}`}>
                    {formatNumber(forecast.playerMinuteImpact)}
                  </span>
                </td>
                <td className="num pp-number">
                  <span className={`pp-heat ${heatClass(forecast.netRating)}`}>
                    {formatSigned(forecast.netRating)}
                  </span>
                </td>
                <td className="num pp-number">
                  <span className={`pp-heat ${heatClass(forecast.eloPointValue)}`}>
                    {formatSigned(forecast.eloPointValue)}
                  </span>
                </td>
                <td className="num pp-number">
                  <span
                    className={`pp-heat ${
                      forecast.manualAdjustment > 0
                        ? "text-[var(--color-success)]"
                        : forecast.manualAdjustment < 0
                          ? "text-[var(--color-danger)]"
                          : "pp-heat-zero"
                    }`}
                  >
                    {formatSigned(forecast.manualAdjustment)}
                  </span>
                </td>
                <td className="num pp-number font-bold">
                  <span className={`pp-heat ${heatClass(forecast.finalStrength)}`}>
                    {formatSigned(forecast.finalStrength)}
                  </span>
                </td>
                <td>
                  <span className="pp-probbar h-[9px]">
                    <span
                      className="pp-probbar-fill"
                      style={{ width: `${scale * 100}%` }}
                    />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
