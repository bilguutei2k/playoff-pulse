import type { InjuryStatus, Player, Team } from "@/lib/model/types";

export const TEAM_ROTATION_MINUTES = 240;
export const MAX_PLAYER_MINUTES = 48;

export type PlayerScenarioOverride = {
  projectedMinutes?: number;
  injuryStatus?: InjuryStatus;
};

export type RotationScenario = {
  overrides?: Record<string, PlayerScenarioOverride>;
  replacementImpact?: number;
  replacementLabel?: string;
};

export type RotationAllocation = {
  team: Team;
  playerMinutes: Record<string, number>;
  replacementMinutes: number;
  requestedMinutes: number;
  scaledToFit: boolean;
};

function boundedMinutes(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_PLAYER_MINUTES, Math.max(0, value));
}

/**
 * Produces a complete 240-minute rotation. Missing or vacated minutes become a
 * disclosed replacement-level player; if requested player minutes exceed 240,
 * every active allocation is proportionally scaled to preserve relative roles.
 */
export function allocateScenarioRotation(
  team: Team,
  scenario: RotationScenario = {},
): RotationAllocation {
  const overrides = scenario.overrides ?? {};
  const requestedPlayers: Player[] = team.players.map((player) => {
    const override = overrides[player.id];
    const injuryStatus = override?.injuryStatus ?? player.injuryStatus;
    const requested = override?.projectedMinutes ?? player.projectedMinutes;
    return {
      ...player,
      injuryStatus,
      projectedMinutes: injuryStatus === "out" ? 0 : boundedMinutes(requested),
    };
  });
  const requestedMinutes = requestedPlayers.reduce(
    (sum, player) => sum + player.projectedMinutes,
    0,
  );
  const scale = requestedMinutes > TEAM_ROTATION_MINUTES
    ? TEAM_ROTATION_MINUTES / requestedMinutes
    : 1;
  const players = requestedPlayers.map((player) => ({
    ...player,
    projectedMinutes: Number((player.projectedMinutes * scale).toFixed(6)),
  }));
  const allocated = players.reduce((sum, player) => sum + player.projectedMinutes, 0);
  const replacementMinutes = Number(
    Math.max(0, TEAM_ROTATION_MINUTES - allocated).toFixed(6),
  );
  if (replacementMinutes > 0) {
    players.push({
      id: `${team.id}-replacement`,
      name: scenario.replacementLabel ?? "Replacement minutes",
      teamId: team.id,
      impact: scenario.replacementImpact ?? 0,
      projectedMinutes: replacementMinutes,
      healthyProjectedMinutes: replacementMinutes,
      injuryStatus: "healthy",
    });
  }
  const playerMinutes = Object.fromEntries(
    players.map((player) => [player.id, player.projectedMinutes]),
  );
  return {
    team: { ...team, players },
    playerMinutes,
    replacementMinutes,
    requestedMinutes,
    scaledToFit: scale < 1,
  };
}
