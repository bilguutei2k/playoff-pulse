// Runs the live job's report check over every report stored for past seasons. A check that
// looks reasonable on one sample can still reject a real slate: this is the test that would
// have caught the rule that voided about one slate in six.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { reportForSlate, type ParsedReport } from "@/lib/live-data/nba-reports";
import type { StatusCode, StoredPoint, StoredReports } from "@/lib/season/availability";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { SeasonGame } from "@/lib/season/types";

const SEASONS = [2022, 2023, 2024, 2025, 2026];
const STATUS_WORDS: Record<StatusCode, ParsedReport["rows"][number]["status"]> = {
  O: "Out",
  D: "Doubtful",
  Q: "Questionable",
  P: "Probable",
  A: "Available",
};
const nameOf = new Map(SEASON_TEAMS.map((team) => [team.id, team.name]));

function readJson<T>(...parts: string[]): T {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), ...parts), "utf-8")) as T;
}

function rejectedSlates(season: number, which: "morning" | "final"): { slates: number; rejected: string[] } {
  const reports = readJson<StoredReports>("data/season/reports", `${season}.json`);
  const stored = readJson<SeasonGame[] | { games: SeasonGame[] }>("data/season/games", `${season}.json`);
  const games = new Map((Array.isArray(stored) ? stored : stored.games).map((game) => [game.id, game]));
  const byDate = new Map<string, Array<{ game: SeasonGame; point: StoredPoint }>>();
  for (const [gameId, entry] of Object.entries(reports.games)) {
    const game = games.get(gameId);
    const point = entry[which];
    if (!game || !point) continue;
    byDate.set(game.etDate, [...(byDate.get(game.etDate) ?? []), { game, point }]);
  }
  const rejected: string[] = [];
  for (const [etDate, entries] of byDate) {
    const rows: ParsedReport["rows"] = entries.flatMap(({ game, point }) => {
      const matchup = `${game.awayId}@${game.homeId}`;
      return [
        ...point.notSubmitted.map((teamId) => ({
          gameDate: etDate,
          matchup,
          team: nameOf.get(teamId) as string,
          player: null,
          status: null,
          reason: "NOT YET SUBMITTED",
        })),
        ...point.rows.map(([teamId, player, status]) => ({
          gameDate: etDate,
          matchup,
          team: nameOf.get(teamId) as string,
          player,
          status: STATUS_WORDS[status],
          reason: "",
        })),
      ];
    });
    const result = reportForSlate(
      { issuedEt: `${etDate}T12:00`, rows },
      "stored",
      etDate,
      entries.map(({ game }) => game),
    );
    if (!result.ok) rejected.push(`${etDate}: ${result.problem}`);
  }
  return { slates: byDate.size, rejected };
}

describe("the report check against five seasons of real reports", () => {
  for (const season of SEASONS) {
    for (const which of ["morning", "final"] as const) {
      it(`accepts every ${which} slate of ${season}`, () => {
        const { slates, rejected } = rejectedSlates(season, which);
        expect(slates).toBeGreaterThan(200);
        expect(rejected).toEqual([]);
      });
    }
  }
});
