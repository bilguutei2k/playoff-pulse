/** The single preregistered regression check, never a selection or fitting script. */
import * as fs from "node:fs";
import { etWallClockOf } from "../../src/lib/season/dates";
import { currentAbsences, replayInjuryModel, simulationAbsences, type ForecastRow } from "../../src/lib/season/injury-model";
import { currentAbsencesV3, replayInjuryV3, type HazardTable } from "../../src/lib/season/injury-v3";
import { INJURY_PARAMS, INJURY_STATUS_TABLE, INJURY_SURVIVAL, LIVE_PARAMS, SIMULATOR_UNCERTAINTY_SCALE } from "../../src/lib/season/params";
import { replayRatings } from "../../src/lib/season/ratings";
import { simulateSeason } from "../../src/lib/season/simulate";
import { buildStandings } from "../../src/lib/season/standings";
import { SEASON_TEAMS } from "../../src/lib/season/teams";
import { loadAvailabilityData } from "./availability-store";
import { loadHistory, loadSeasonGames, compareGames } from "./game-store";
import { brier, type ScoredGame } from "./eval-metrics";

const hazards = (JSON.parse(fs.readFileSync("docs/live/v3-fit.json", "utf8")) as { table: HazardTable }).table;
const all = loadHistory(2026).sort(compareGames);
const base = replayRatings(all.filter((g) => g.season < 2021), LIVE_PARAMS).state;
const games = all.filter((g) => g.season >= 2021);
const data = loadAvailabilityData([2021, 2022, 2023, 2024, 2025, 2026], [2022, 2023, 2024, 2025, 2026]);
const common = () => ({ games, state: { mean: base.mean.slice(), cov: base.cov.slice() }, stateSeason: 2020,
  params: LIVE_PARAMS, injury: INJURY_PARAMS, statusTable: INJURY_STATUS_TABLE, ...data });
function collect(v3: boolean): ScoredGame[] {
  const rows: ScoredGame[] = [];
  (v3 ? replayInjuryV3 : replayInjuryModel)({ ...common(), onForecast: (row: ForecastRow) => {
    const { game } = row;
    const final = row.availability?.final;
    if (![2025, 2026].includes(game.season) || game.kind !== "regular" || !final || final.notSubmitted.length) return;
    if (Date.parse(`${etWallClockOf(game.tipUtc)}:00Z`) - Date.parse(`${final.at}:00Z`) > 3 * 3600000) return;
    rows.push({ id: game.id, season: game.season, p: row.final.homeWinProbability,
      y: Number((game.homeScore as number) > (game.awayScore as number)) as 0 | 1 });
  } });
  return rows;
}
const v2Rows = collect(false), v3Rows = collect(true);
if (JSON.stringify(v2Rows.map((r) => r.id)) !== JSON.stringify(v3Rows.map((r) => r.id))) throw new Error("Unpaired game set");
const perSeason = [2025, 2026].map((season) => ({ season,
  games: v3Rows.filter((r) => r.season === season).length,
  v2: brier(v2Rows.filter((r) => r.season === season)), v3: brier(v3Rows.filter((r) => r.season === season)) }));
const gameCheck = { games: v3Rows.length, v2: brier(v2Rows), v3: brier(v3Rows),
  difference: brier(v3Rows) - brier(v2Rows), tolerance: 0.002, perSeason };
const checks = [];
for (const checkpoint of ["dec1", "feb1", "apr1"]) {
  const scores = { v1: { b: 0, s: 0 }, v2: { b: 0, s: 0 }, v3: { b: 0, s: 0 } };
  for (const season of [2025, 2026]) {
    const date = checkpoint === "dec1" ? `${season - 1}-12-01` : `${season}-${checkpoint === "feb1" ? "02" : "04"}-01`;
    const full = loadSeasonGames(season);
    const made = new Set(full.filter((g) => g.kind === "playoff" && g.status === "final").flatMap((g) => [g.homeId, g.awayId]));
    const wins = buildStandings(full).wins;
    const known = full.filter((g) => g.kind === "regular" || g.kind === "cup-final").map((g) =>
      g.status === "final" && g.etDate >= date ? { ...g, status: "scheduled" as const, homeScore: null, awayScore: null } : g);
    const pending: Record<string, number> = {};
    for (const g of known) if (g.kind === "regular" && g.status === "scheduled") {
      pending[g.homeId] = (pending[g.homeId] ?? 0) + 1; pending[g.awayId] = (pending[g.awayId] ?? 0) + 1;
    }
    for (const version of ["v1", "v2", "v3"] as const) {
      const injury = version === "v1" ? { ...INJURY_PARAMS, beta: 0 } : INJURY_PARAMS;
      const replay = (version === "v3" ? replayInjuryV3 : replayInjuryModel)({ ...common(), injury, throughEtDate: date });
      const current = version === "v3" ? currentAbsencesV3(replay.tracker, injury, INJURY_SURVIVAL,
        { expireInferred: true, hazards, statusTable: INJURY_STATUS_TABLE }).current : currentAbsences(replay.tracker, injury, INJURY_SURVIVAL);
      const forecast = simulateSeason({ season, phase: "regular-season", games: known, state: replay.state, params: LIVE_PARAMS,
        asOfEtDate: date, lastGameEtDate: replay.lastGameEtDate, iterations: 4000, uncertaintyScale: SIMULATOR_UNCERTAINTY_SCALE,
        ...(version === "v3" ? { absenceSchedule: { mode: "v3" as const, current, hazards } }
          : version === "v2" ? { absences: simulationAbsences(current, pending) } : {}),
      });
      forecast.teams.forEach((t, i) => { scores[version].b += (t.makePlayoffs - Number(made.has(t.teamId))) ** 2;
        scores[version].s += (t.projectedWins - wins[i]) ** 2; });
    }
  }
  const metrics = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { brier: v.b / SEASON_TEAMS.length / 2, rmse: Math.sqrt(v.s / SEASON_TEAMS.length / 2) }])) as Record<"v1" | "v2" | "v3", { brier: number; rmse: number }>;
  checks.push({ checkpoint, ...metrics, passed: metrics.v3.brier <= metrics.v1.brier + 0.005 && metrics.v3.rmse <= metrics.v1.rmse + 0.25 });
  console.log(JSON.stringify(checks.at(-1)));
}
const output = { note: "Regression abort check only; previously examined seasons, realized-schedule T4 reconstruction.", gameCheck, checks,
  passed: Math.abs(gameCheck.difference) <= 0.002 && checks.every((r) => r.passed) };
fs.writeFileSync("/tmp/pp-v3-regression.json", JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output, null, 2));
if (!output.passed) process.exitCode = 2;
