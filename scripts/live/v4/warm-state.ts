// The one v4 module that passes through the closed seasons (2024-25 and 2025-26): it runs the
// filter to today's state for the live job (Phase C) and returns a state and nothing else.
// It prints, logs and stores nothing about those seasons, and computes no score.

import { addToNameIndex, createNameIndex, resolvePlayer, type StoredReports } from "../../../src/lib/season/availability";
import type { StoredBoxScores } from "../../../src/lib/season/box-scores";
import type { ReportPoint } from "../../../src/lib/season/injury-model";
import { warmState, type RosterState, type StatusWeights, type V4GameLines, type V4RatingParams } from "../../../src/lib/season/roster-state";
import type { SeasonGame } from "../../../src/lib/season/types";
import * as fs from "node:fs";
import * as path from "node:path";
import { readPlayerGames, readReports, readSeasonGames } from "./season-files";

const FIRST = 2011;
const REPORTS_FROM = 2022;

function compareGames(a: SeasonGame, b: SeasonGame): number {
  const byTip = Date.parse(a.tipUtc) - Date.parse(b.tipUtc);
  return byTip !== 0 ? byTip : a.id.localeCompare(b.id);
}

/**
 * The state after every ET date before `throughEtDate`, through the stored seasons (last
 * stored season inclusive), with the frozen parameters and status weights.
 */
export function warmStateThrough(options: {
  lastStoredSeason: number;
  throughEtDate: string;
  ratings: V4RatingParams;
  statusTable: StatusWeights;
  /** Extra games, lines and reports of the live season (Phase C). */
  extraGames?: readonly SeasonGame[];
  extraLines?: (gameId: string) => V4GameLines | undefined;
  extraReport?: (game: SeasonGame) => ReportPoint | null;
  openingRoster?: (season: number) => ReadonlyMap<string, readonly string[]> | null;
}): RosterState {
  const games: SeasonGame[] = [];
  const lines = new Map<string, V4GameLines>();
  const names = createNameIndex();
  const reports = new Map<number, StoredReports>();
  for (let season = FIRST; season <= options.lastStoredSeason; season += 1) {
    games.push(...readSeasonGames(season));
    for (const [id, game] of Object.entries(readPlayerGames(season).games)) lines.set(id, game as V4GameLines);
    const box = path.join(process.cwd(), "data/season/boxscores", `${season}.json`);
    if (fs.existsSync(box)) {
      const store = JSON.parse(fs.readFileSync(box, "utf-8")) as StoredBoxScores;
      for (const game of Object.values(store.games)) {
        for (const [teamId, rows] of Object.entries(game)) for (const row of rows) addToNameIndex(names, season, teamId, row[0], store.names[row[0]]);
      }
    }
    if (season >= REPORTS_FROM) {
      const stored = readReports(season);
      if (stored) reports.set(season, stored);
    }
  }
  games.push(...(options.extraGames ?? []));
  games.sort(compareGames);
  const opening = new Map<number, Map<string, string[]>>();
  const openingRosters = (season: number) => {
    const live = options.openingRoster?.(season);
    if (live) return live;
    let rosters = opening.get(season);
    if (!rosters) {
      const counts = new Map<string, number>();
      const sets = new Map<string, Set<string>>();
      for (const game of games.filter((row) => row.season === season && row.kind === "regular" && row.status === "final")) {
        for (const teamId of [game.homeId, game.awayId]) {
          if ((counts.get(teamId) ?? 0) >= 5) continue;
          counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
          const set = sets.get(teamId) ?? new Set<string>();
          for (const line of lines.get(game.id)?.[teamId] ?? []) if (line[1] > 0) set.add(line[0]);
          sets.set(teamId, set);
        }
      }
      rosters = new Map([...sets].map(([teamId, set]) => [teamId, [...set].sort()]));
      opening.set(season, rosters);
    }
    return rosters;
  };
  const reportFor = (game: SeasonGame): ReportPoint | null => {
    const stored = reports.get(game.season);
    const point = stored?.games[game.id]?.final;
    if (!stored || !point) return options.extraReport?.(game) ?? null;
    return {
      at: point.at,
      notSubmitted: point.notSubmitted,
      rows: point.rows.map(([teamId, player, status, reason]) => ({
        teamId,
        athleteId: resolvePlayer(names, game.season, teamId, player),
        status,
        reason: stored.reasons[reason],
      })),
    };
  };
  return warmState({
    games,
    linesFor: (id) => lines.get(id) ?? options.extraLines?.(id),
    reportFor,
    openingRosters,
    params: options.ratings,
    statusTable: () => options.statusTable,
    throughEtDate: options.throughEtDate,
  });
}
