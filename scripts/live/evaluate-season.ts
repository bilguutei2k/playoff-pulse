// Season-level gates S1-S3. Re-runs the simulator from fixed dates in past seasons,
// seeing only what was known on each date, and scores the outcome.
//
// Gate seasons: 2016-2019 and 2022 (2020 and 2021 were irregular).
// Reported separately: 2023-2026. The win-percentage baseline is fitted on
// development seasons only.
//
// Run: corepack pnpm exec tsx scripts/live/evaluate-season.ts [uncertaintyScale]

import * as fs from "node:fs";
import * as path from "node:path";
import { fitLogisticModel, predictLogistic } from "../../src/lib/backtest/regression";
import { LIVE_PARAMS } from "../../src/lib/season/params";
import { replayRatings } from "../../src/lib/season/ratings";
import { simulateSeason } from "../../src/lib/season/simulate";
import { buildStandings } from "../../src/lib/season/standings";
import { SEASON_TEAMS } from "../../src/lib/season/teams";
import type { SeasonGame } from "../../src/lib/season/types";
import { round } from "./eval-metrics";
import { compareGames, loadHistory, loadSeasonGames } from "./game-store";

const ITERATIONS = 4000;
const GATE_SEASONS = [2016, 2017, 2018, 2019, 2022];
const SEPARATE_SEASONS = [2023, 2024, 2025, 2026];
const DEVELOPMENT_SEASONS = [2006, 2007, 2008, 2009, 2010, 2011, 2013, 2014, 2015];
const CHECKPOINTS = ["opening", "dec1", "feb1", "apr1"] as const;
type Checkpoint = (typeof CHECKPOINTS)[number];

const uncertaintyScale = Number(process.argv[2] ?? 1);

function checkpointDate(season: number, checkpoint: Checkpoint, games: SeasonGame[]): string {
  if (checkpoint === "dec1") return `${season - 1}-12-01`;
  if (checkpoint === "feb1") return `${season}-02-01`;
  if (checkpoint === "apr1") return `${season}-04-01`;
  const first = games.find((game) => game.kind === "regular");
  if (!first) throw new Error(`Season ${season} has no regular games.`);
  return first.etDate;
}

/** The season as it looked on a date: later results are hidden. */
function asOfDate(games: readonly SeasonGame[], etDate: string): SeasonGame[] {
  return games
    .filter((game) => game.kind === "regular" || game.kind === "cup-final")
    .map((game) =>
      game.status === "final" && game.etDate >= etDate
        ? { ...game, status: "scheduled" as const, homeScore: null, awayScore: null }
        : game,
    );
}

function actualOutcome(season: number) {
  const games = loadSeasonGames(season);
  const made = new Set<string>();
  let champion: string | null = null;
  for (const game of games) {
    if (game.kind !== "playoff" || game.status !== "final") continue;
    made.add(game.homeId);
    made.add(game.awayId);
    if (game.round === "finals") {
      champion =
        (game.homeScore as number) > (game.awayScore as number) ? game.homeId : game.awayId;
    }
  }
  const table = buildStandings(games);
  return { made, champion, finalWins: table.wins, games };
}

// Baseline: logistic on current win percentage, fitted per checkpoint on
// development seasons only.
const baselineModels = new Map<Checkpoint, ReturnType<typeof fitLogisticModel>>();
for (const checkpoint of CHECKPOINTS) {
  if (checkpoint === "opening") continue;
  const features: number[][] = [];
  const outcomes: number[] = [];
  for (const season of DEVELOPMENT_SEASONS) {
    const { games, made } = actualOutcome(season);
    const date = checkpointDate(season, checkpoint, games);
    const table = buildStandings(asOfDate(games, date));
    SEASON_TEAMS.forEach((team, index) => {
      const played = table.wins[index] + table.losses[index];
      features.push([played === 0 ? 0.5 : table.wins[index] / played]);
      outcomes.push(made.has(team.id) ? 1 : 0);
    });
  }
  baselineModels.set(
    checkpoint,
    fitLogisticModel(features, outcomes, ["winPercentage"], 1),
  );
}

type Row = {
  season: number;
  checkpoint: Checkpoint;
  teamId: string;
  pMake: number;
  baselinePMake: number | null;
  made: 0 | 1;
  projectedWins: number;
  extrapolatedWins: number | null;
  finalWins: number;
  pTitle: number;
  champion: 0 | 1;
};

const history = loadHistory(2026).sort(compareGames);

function simulateSeasons(seasons: number[]): Row[] {
  const rows: Row[] = [];
  for (const season of seasons) {
    const { games, made, champion, finalWins } = actualOutcome(season);
    for (const checkpoint of CHECKPOINTS) {
      const date = checkpointDate(season, checkpoint, games);
      const known = asOfDate(games, date);
      const replay = replayRatings(history, LIVE_PARAMS, {
        isIncluded: (game) => game.etDate < date,
        asOfEtDate: date,
      });
      const lastGameEtDate = replay.lastGameEtDate;
      // At opening night the most recent games are last season's.
      if (checkpoint === "opening") {
        for (const key of Object.keys(lastGameEtDate)) lastGameEtDate[key] = null;
      }
      const forecast = simulateSeason({
        season,
        phase: "regular-season",
        games: known,
        state: replay.state,
        params: LIVE_PARAMS,
        asOfEtDate: date,
        lastGameEtDate,
        iterations: ITERATIONS,
        uncertaintyScale,
      });
      const baselineModel = baselineModels.get(checkpoint);
      const table = buildStandings(known);
      forecast.teams.forEach((team, index) => {
        const played = table.wins[index] + table.losses[index];
        const percentage = played === 0 ? 0.5 : table.wins[index] / played;
        const seasonGames = games.filter(
          (game) =>
            game.kind === "regular" &&
            game.status === "final" &&
            (game.homeId === team.teamId || game.awayId === team.teamId),
        ).length;
        rows.push({
          season,
          checkpoint,
          teamId: team.teamId,
          pMake: team.makePlayoffs,
          baselinePMake: baselineModel
            ? predictLogistic(baselineModel, [percentage])
            : null,
          made: made.has(team.teamId) ? 1 : 0,
          projectedWins: team.projectedWins,
          extrapolatedWins: played > 0 ? percentage * seasonGames : null,
          finalWins: finalWins[index],
          pTitle: team.champion,
          champion: champion === team.teamId ? 1 : 0,
        });
      });
      process.stderr.write(`${season} ${checkpoint} done\n`);
    }
  }
  return rows;
}

function brierOf(pairs: Array<[number, number]>): number {
  return pairs.reduce((sum, [p, y]) => sum + (p - y) ** 2, 0) / pairs.length;
}

function rmse(pairs: Array<[number, number]>): number {
  return Math.sqrt(pairs.reduce((sum, [a, b]) => sum + (a - b) ** 2, 0) / pairs.length);
}

function reliabilityBins(rows: Row[]) {
  const bins = Array.from({ length: 10 }, (_, index) => ({
    low: index / 10,
    n: 0,
    sumP: 0,
    sumY: 0,
  }));
  for (const row of rows) {
    const bin = bins[Math.min(9, Math.floor(row.pMake * 10))];
    bin.n += 1;
    bin.sumP += row.pMake;
    bin.sumY += row.made;
  }
  return bins
    .filter((bin) => bin.n > 0)
    .map((bin) => ({
      bin: `${bin.low.toFixed(1)}-${(bin.low + 0.1).toFixed(1)}`,
      n: bin.n,
      predicted: round(bin.sumP / bin.n, 3),
      observed: round(bin.sumY / bin.n, 3),
      gap: round(Math.abs(bin.sumP - bin.sumY) / bin.n, 3),
    }));
}

function evaluate(rows: Row[]) {
  return Object.fromEntries(
    CHECKPOINTS.map((checkpoint) => {
      const subset = rows.filter((row) => row.checkpoint === checkpoint);
      const makeBrier = brierOf(subset.map((row) => [row.pMake, row.made]));
      const baselineBrier =
        checkpoint === "opening"
          ? null
          : brierOf(subset.map((row) => [row.baselinePMake as number, row.made]));
      const winRmse = rmse(subset.map((row) => [row.projectedWins, row.finalWins]));
      const extrapolationRmse =
        checkpoint === "opening"
          ? null
          : rmse(subset.map((row) => [row.extrapolatedWins as number, row.finalWins]));
      const bins = reliabilityBins(subset);
      const populated = bins.filter((bin) => bin.n >= 10);
      return [
        checkpoint,
        {
          teamSeasons: subset.length,
          makePlayoffsBrier: round(makeBrier, 4),
          baselineBrier: baselineBrier === null ? null : round(baselineBrier, 4),
          winTotalRmse: round(winRmse, 2),
          extrapolationRmse: extrapolationRmse === null ? null : round(extrapolationRmse, 2),
          s1: baselineBrier === null ? null : makeBrier < baselineBrier,
          s2: populated.every((bin) => bin.gap <= 0.1),
          s3:
            checkpoint === "opening" || extrapolationRmse === null
              ? null
              : winRmse < extrapolationRmse,
          reliabilityBins: bins,
        },
      ];
    }),
  );
}

function titleSummary(rows: Row[]) {
  return Object.fromEntries(
    CHECKPOINTS.map((checkpoint) => {
      const subset = rows.filter((row) => row.checkpoint === checkpoint);
      const champions = subset.filter((row) => row.champion === 1);
      const logLoss =
        champions.reduce((sum, row) => sum - Math.log(Math.max(row.pTitle, 1e-4)), 0) /
        champions.length;
      return [
        checkpoint,
        {
          seasons: champions.length,
          meanChampionProbability: round(
            champions.reduce((sum, row) => sum + row.pTitle, 0) / champions.length,
            3,
          ),
          meanChampionLogLoss: round(logLoss, 3),
          uniformLogLoss: round(Math.log(30), 3),
          perSeason: champions.map((row) => ({
            season: row.season,
            teamId: row.teamId,
            probability: round(row.pTitle, 3),
          })),
        },
      ];
    }),
  );
}

const gateRows = simulateSeasons(GATE_SEASONS);
const separateRows = simulateSeasons(SEPARATE_SEASONS);
const report = {
  uncertaintyScale,
  iterations: ITERATIONS,
  gateSeasons: {
    seasons: GATE_SEASONS,
    byCheckpoint: evaluate(gateRows),
    title: titleSummary(gateRows),
  },
  reportedSeparately: {
    label: "model form chosen with sight of these seasons",
    seasons: SEPARATE_SEASONS,
    byCheckpoint: evaluate(separateRows),
    title: titleSummary(separateRows),
  },
};

const output = path.join(process.cwd(), "docs/live/evaluation-season.json");
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
console.log(JSON.stringify(report, null, 2));
