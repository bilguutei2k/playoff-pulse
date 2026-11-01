// Audits the stored game history. Exits non-zero on impossible data.
// Run: corepack pnpm exec tsx scripts/live/audit-history.ts

import { seasonFormat } from "../../src/lib/season/formats";
import { SEASON_TEAMS } from "../../src/lib/season/teams";
import { loadSeasonGames } from "./game-store";

let problems = 0;
function problem(message: string): void {
  problems += 1;
  console.log(`  PROBLEM ${message}`);
}

for (let season = 2005; season <= 2026; season += 1) {
  const games = loadSeasonGames(season);
  const format = seasonFormat(season);
  const byKind: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const counts = new Map(SEASON_TEAMS.map((team) => [team.id, 0]));
  const ids = new Set<string>();
  for (const game of games) {
    byKind[game.kind] = (byKind[game.kind] ?? 0) + 1;
    byStatus[game.status] = (byStatus[game.status] ?? 0) + 1;
    if (ids.has(game.id)) problem(`duplicate game ${game.id}`);
    ids.add(game.id);
    if (game.kind === "regular" && game.status === "final") {
      counts.set(game.homeId, (counts.get(game.homeId) ?? 0) + 1);
      counts.set(game.awayId, (counts.get(game.awayId) ?? 0) + 1);
    }
    if (game.status === "final" && game.homeScore === game.awayScore) {
      problem(`tied final ${game.id}`);
    }
  }
  const values = [...counts.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const playoffs = games.filter((game) => game.kind === "playoff" && game.status === "final");
  const missingRound = playoffs.filter((game) => !game.round).length;
  const playIn = games.filter((game) => game.kind === "play-in" && game.status === "final");
  const playInStageMissing = playIn.filter((game) => !game.playIn).length;
  console.log(
    `${season} kinds=${JSON.stringify(byKind)} status=${JSON.stringify(byStatus)} ` +
      `perTeam=${min}-${max} (format ${format.gamesPerTeam}) ` +
      `playoffMissingRound=${missingRound} playInMissingStage=${playInStageMissing}`,
  );
  if (!format.irregular && (max > format.gamesPerTeam || min < format.gamesPerTeam - 1)) {
    problem(`${season} per-team count ${min}-${max} against format ${format.gamesPerTeam}`);
  }
}
console.log(problems === 0 ? "No impossible data." : `${problems} problem(s).`);
process.exit(problems === 0 ? 0 : 1);
