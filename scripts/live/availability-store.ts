// Loads stored box scores and injury reports, and resolves report names to athletes.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  addToNameIndex,
  createNameIndex,
  resolvePlayer,
  type NameIndex,
  type StoredReports,
} from "../../src/lib/season/availability";
import type { StoredBoxScores, StoredLine } from "../../src/lib/season/box-scores";
import type { GameAvailability, ReportPoint } from "../../src/lib/season/injury-model";

/** The registered box-score seasons, which fix the name resolver's global step. */
export const NAME_SEASONS = [2021, 2022, 2023, 2024, 2025, 2026];

const BOX_DIRECTORY = path.join(process.cwd(), "data", "season", "boxscores");
const REPORT_DIRECTORY = path.join(process.cwd(), "data", "season", "reports");

export function loadBoxScores(season: number): StoredBoxScores {
  const file = path.join(BOX_DIRECTORY, `${season}.json`);
  return JSON.parse(fs.readFileSync(file, "utf-8")) as StoredBoxScores;
}

export function loadReports(season: number): StoredReports | null {
  const file = path.join(REPORT_DIRECTORY, `${season}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as StoredReports;
}

export function buildNameIndex(stores: readonly StoredBoxScores[]): NameIndex {
  const index = createNameIndex();
  for (const store of stores) {
    for (const game of Object.values(store.games)) {
      for (const [teamId, lines] of Object.entries(game)) {
        for (const line of lines) {
          addToNameIndex(index, store.season, teamId, line[0], store.names[line[0]]);
        }
      }
    }
  }
  return index;
}

export type AvailabilityData = {
  boxScores: (gameId: string) => Record<string, StoredLine[]> | undefined;
  availability: (gameId: string) => GameAvailability | null;
};

/**
 * Box scores come only from `boxSeasons` and reports only from `reportSeasons`. The name
 * index always spans `NAME_SEASONS`: it fixes who a name is, and carries no results.
 */
export function loadAvailabilityData(boxSeasons: number[], reportSeasons: number[]): AvailabilityData {
  const index = buildNameIndex(NAME_SEASONS.map(loadBoxScores));
  const box = new Map<string, Record<string, StoredLine[]>>();
  for (const store of boxSeasons.map(loadBoxScores)) {
    for (const [gameId, game] of Object.entries(store.games)) box.set(gameId, game);
  }
  const points = new Map<string, GameAvailability>();
  for (const season of reportSeasons) {
    const reports = loadReports(season);
    if (!reports) throw new Error(`No stored reports for ${season}.`);
    const toPoint = (point: StoredReports["games"][string]["final"]): ReportPoint | null =>
      point && {
        at: point.at,
        notSubmitted: point.notSubmitted,
        rows: point.rows.map(([teamId, player, status, reason]) => ({
          teamId,
          athleteId: resolvePlayer(index, season, teamId, player),
          status,
          reason: reports.reasons[reason],
        })),
      };
    for (const [gameId, game] of Object.entries(reports.games)) {
      points.set(gameId, { morning: toPoint(game.morning), final: toPoint(game.final) });
    }
  }
  return {
    boxScores: (gameId) => box.get(gameId),
    availability: (gameId) => points.get(gameId) ?? null,
  };
}
