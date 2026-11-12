// Fits Stage 2 of the 548 score (the on-court layer) on the training era only (seasons up
// to 2019-20) and writes docs/score/fit-stage2.json: the (λ, ρ) tuning table with, for
// every cell, the criterion (the forward stint loss) and the two compared criteria (the
// game-level and season-to-season leave-one-season-out RMSEs), the chosen pair, Stage 1's
// forward loss and the slope γ for the record, Stage 2's team line and game line, and a
// check that the walk reproduces Stage 1's frozen game-level criterion.
//
// Stage 1's coefficients and book parameters are read from docs/score/fit.json, never
// refitted. It refuses, in code, to load any season after 2020 (`loadTrainingGames`).
// Deterministic: no randomness, sorted keys, no clock in the output.
//
// Run: corepack pnpm exec tsx scripts/score/fit-stage2.ts

import { fitTeamLine, type TeamLine } from "../../src/lib/score/book";
import type { OnCourtParams } from "../../src/lib/score/on-court";
import type { ScoreGame } from "../../src/lib/score/types";
import {
  FIRST_SEASON,
  LAST_TRAINING_SEASON,
  MIN_PRIOR_MINUTES,
  TRAINING_TARGET_SEASONS,
  coverage,
  inputHashes,
  leaveSeasonOutRmse,
  loadTrainingGames,
  predictTargets,
  range,
  rmseOfPredictions,
  seasonFacts,
  targetRows,
  teamTargets,
  writeJson,
  type GameLoader,
  type SeasonCoverage,
  type SeasonFacts,
} from "./score-data";
import {
  CHECKPOINT_DAYS,
  FIT_STAGE2_PATH,
  MAX_LAMBDA_EXTENSIONS,
  STAGE2_GRID,
  bestCell,
  endBoxValues,
  endRatings,
  forwardBySeason,
  forwardLoss,
  leaveSeasonOutGameRmse,
  loadStage1,
  maeOfResiduals,
  residuals,
  restrictToQualifying,
  rmseOfResiduals,
  slopeOf,
  sortCells,
  tuningCells,
  type ForwardSeason,
  type Slope,
  type Stage1Inputs,
  type TuningCell,
} from "./stage2-data";
import { loadScoreGames } from "./store";

export const FIT_STAGE2_VERSION = 2;

export type Stage2Fit = {
  version: number;
  trainingSeasons: number[];
  inputs: { files: Record<string, string>; combined: string };
  stage1: {
    fitSha256: string;
    book: { decay: number; pseudoPossessions: number; replacement: number };
    /** The walk's Stage 1 game-level criterion (δ = 0), which must equal fit.json's book.chosen.rmse. */
    criterionRecomputed: number;
    criterionFrozen: number;
    /** Stage 1's season-to-season leave-one-season-out RMSE, recomputed by the walk. */
    endpointRmseLeaveSeasonOut: number;
    /** Stage 1's forward stint loss (δ = 0 everywhere): the reference for the criterion. */
    forwardLoss: number;
    /** The home term fixed in every forward prediction (`fit.json → primary.home`). */
    home: number;
  };
  /** The criterion's data: stints of audit-accepted games of the criterion seasons. */
  forwardData: { stints: number; games: number; possessions: number };
  /**
   * For the record, not used: the unpenalised slope γ of y − h on the home-minus-away
   * rating sum. For Stage 1 (Σ b) and for the chosen Stage 2 rating (Σ r).
   */
  slope: { stage1: Slope; stage2Chosen: Slope };
  settings: {
    checkpointDays: number;
    grid: { lambda: number[]; rho: number[] };
    /** λ values evaluated beyond the registered grid because the optimum sat on its edge. */
    lambdaExtensions: number[];
    criterionSeasons: number[];
    minPriorMinutes: number;
  };
  coverage: SeasonCoverage[];
  tuning: {
    method: string;
    /** Every cell, λ then ρ ascending. */
    table: TuningCell[];
    chosen: TuningCell;
    onEdge: { lambda: boolean; rho: boolean };
    /** The criterion at the chosen cell beside Stage 1's: ratio and 1 − ratio. */
    chosenVsStage1: { ratio: number; improvement: number };
    /** The chosen cell's forward loss per criterion season, beside Stage 1's. */
    chosenBySeason: ForwardSeason[];
    /** The best criterion at each λ (over ρ) and each ρ (over λ): the table's shape. */
    profileLambda: Array<{ lambda: number; forwardLoss: number; rho: number }>;
    profileRho: Array<{ rho: number; forwardLoss: number; lambda: number }>;
    /** For comparison only: the cell each other criterion would have chosen on the same table. */
    otherCriteria: { gameRmse: TuningCell & { onEdge: boolean }; endpointRmse: TuningCell & { onEdge: boolean } };
  };
  /** Stage 2's team line a + b × Σ share × v + c × u, fitted on training pairs and frozen. */
  teamLine: TeamLine;
  trainingPairs: number;
  /** In-sample RMSE of the training pairs with that line, and leave-one-season-out. */
  teamTrainingRmse: number;
  teamRmseLeaveSeasonOut: number;
  /** Stage 2's game line home + g × Δ(Σ share × v) + c × Δu, fitted on training games and frozen. */
  gameLine: TeamLine & { games: number; trainingRmse: number; trainingMae: number };
};

export type Stage2FitOptions = {
  loader?: GameLoader;
  /** Stage 1's frozen fit (default: docs/score/fit.json). */
  stage1?: Stage1Inputs;
  seasons?: readonly number[];
  grid?: { lambda: readonly number[]; rho: readonly number[] };
  maxExtensions?: number;
  log?: (line: string) => void;
};

function settingsOf(lambdas: readonly number[], rhos: readonly number[]): OnCourtParams[] {
  const settings: OnCourtParams[] = [];
  for (const lambda of lambdas) for (const rho of rhos) settings.push({ lambda, rho });
  return settings;
}

export function runStage2Fit(options: Stage2FitOptions = {}): Stage2Fit {
  const log = options.log ?? (() => {});
  const seasons = [...(options.seasons ?? range(FIRST_SEASON, LAST_TRAINING_SEASON))];
  // The guard runs before Stage 1 or any game is read.
  const games: ScoreGame[] = loadTrainingGames(seasons, options.loader ?? loadScoreGames);
  const stage1 = options.stage1 ?? loadStage1();
  const grid = options.grid ?? STAGE2_GRID;
  const maxExtensions = options.maxExtensions ?? MAX_LAMBDA_EXTENSIONS;
  log(`[fit-stage2] ${games.length} games, seasons ${seasons[0]}-${seasons[seasons.length - 1]}`);

  const facts = new Map<number, SeasonFacts>(seasons.map((season) => [season, seasonFacts(games, season)]));
  const targetSeasons = TRAINING_TARGET_SEASONS.filter((season) => seasons.includes(season) && seasons.includes(season - 1));
  const targets = teamTargets(facts, targetSeasons);
  const seasonsN = targetSeasons.map((season) => season - 1);

  // The registered grid, then λ extended while the optimum sits on an edge of what has been tried.
  const started = Date.now();
  const first = tuningCells(games, stage1, settingsOf(grid.lambda, grid.rho), targetSeasons, targets, facts);
  log(`[fit-stage2] grid of ${first.cells.length} cells in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  let cells = first.cells;
  const collection = first.collection;
  const runs = [first.collection];
  const lambdaExtensions: number[] = [];
  for (let round = 0; round < 2 * maxExtensions; round += 1) {
    const lambdas = [...new Set(cells.map((c) => c.lambda))].sort((a, b) => a - b);
    const best = bestCell(cells);
    let extra: number | null = null;
    if (best.lambda === lambdas[0] && lambdaExtensions.filter((l) => l < grid.lambda[0]).length < maxExtensions) extra = lambdas[0] / 2;
    if (best.lambda === lambdas[lambdas.length - 1] && lambdaExtensions.filter((l) => l > grid.lambda[grid.lambda.length - 1]).length < maxExtensions) {
      extra = lambdas[lambdas.length - 1] * 2;
    }
    if (extra === null) break;
    log(`[fit-stage2] optimum at λ ${best.lambda} is on the edge; adding λ ${extra}`);
    lambdaExtensions.push(extra);
    const extended = tuningCells(games, stage1, settingsOf([extra], grid.rho), targetSeasons, targets, facts);
    runs.push(extended.collection);
    cells = [...cells, ...extended.cells];
  }
  const table = sortCells(cells);
  const chosen = bestCell(table);
  const lambdas = [...new Set(table.map((c) => c.lambda))].sort((a, b) => a - b);
  const rhos = [...grid.rho].sort((a, b) => a - b);
  // The walk with δ = 0 is Stage 1 itself: its game-level criterion must reproduce fit.json's.
  const stage1Criterion = leaveSeasonOutGameRmse(collection.stage1GameRows);
  const stage1Forward = forwardLoss(collection.forward, "stage1");
  log(
    `[fit-stage2] chosen λ ${chosen.lambda}, ρ ${chosen.rho}: forward loss ${chosen.forwardLoss.toFixed(3)} (Stage 1 ${stage1Forward.toFixed(3)}), ` +
      `game ${chosen.gameRmse.toFixed(4)}, endpoint ${chosen.endpointRmse.toFixed(4)}`,
  );
  const stage1Values = restrictToQualifying(endBoxValues(collection, seasonsN), facts);
  const stage1Endpoint = leaveSeasonOutRmse(targetRows(targets, stage1Values));

  // Stage 2's frozen lines, at the chosen cell.
  const chosenRun = runs.find((run) => run.settings.some((st) => st.lambda === chosen.lambda && st.rho === chosen.rho));
  if (!chosenRun) throw new Error("The chosen cell is in no walk.");
  const chosenCollection = { collection: chosenRun, index: chosenRun.settings.findIndex((st) => st.lambda === chosen.lambda && st.rho === chosen.rho) };
  const values = restrictToQualifying(endRatings(chosenCollection.collection, chosenCollection.index, seasonsN), facts);
  const rows = targetRows(targets, values);
  const teamLine = fitTeamLine(rows);
  const gameRows = chosenCollection.collection.gameRows[chosenCollection.index];
  const gameLine = fitTeamLine(gameRows);
  const gameResiduals = residuals(gameRows, gameLine);

  const profileLambda = lambdas.map((lambda) => {
    const best = bestCell(table.filter((c) => c.lambda === lambda));
    return { lambda, forwardLoss: best.forwardLoss, rho: best.rho };
  });
  const profileRho = rhos.map((rho) => {
    const best = bestCell(table.filter((c) => c.rho === rho));
    return { rho, forwardLoss: best.forwardLoss, lambda: best.lambda };
  });
  const onLambdaEdge = (cell: TuningCell) => cell.lambda === lambdas[0] || cell.lambda === lambdas[lambdas.length - 1];
  const byGame = bestCell(table, "gameRmse");
  const byEndpoint = bestCell(table, "endpointRmse");
  const forwardData = {
    stints: collection.forward.games.reduce((sum, game) => sum + game.stints, 0),
    games: collection.forward.games.length,
    possessions: collection.forward.games.reduce((sum, game) => sum + game.weight, 0),
  };

  return {
    version: FIT_STAGE2_VERSION,
    trainingSeasons: seasons,
    inputs: options.loader ? { files: {}, combined: "injected loader" } : inputHashes(seasons),
    stage1: {
      fitSha256: stage1.fitSha256,
      book: { ...stage1.book },
      criterionRecomputed: stage1Criterion,
      criterionFrozen: stage1.fit.book.chosen.rmse,
      endpointRmseLeaveSeasonOut: stage1Endpoint,
      forwardLoss: stage1Forward,
      home: stage1.home,
    },
    forwardData,
    slope: {
      stage1: slopeOf(collection.forward.slopeStage1),
      stage2Chosen: slopeOf(chosenRun.forward.slopeStage2[chosenCollection.index]),
    },
    settings: {
      checkpointDays: CHECKPOINT_DAYS,
      grid: { lambda: [...grid.lambda], rho: [...grid.rho] },
      lambdaExtensions: [...lambdaExtensions].sort((a, b) => a - b),
      criterionSeasons: [...targetSeasons],
      minPriorMinutes: MIN_PRIOR_MINUTES,
    },
    coverage: coverage(games),
    tuning: {
      method:
        "forward stint loss: possession-weighted mean squared error of each stint's home-minus-away margin per 100 possessions, predicted as h + Σ home five r − Σ away five r with h fixed at Stage 1's primary.home and r = Stage 1 value + δ, both held at the latest checkpoint before the stint's game (before a season's first checkpoint: the Stage 1 value at the season's start + ρ δ_prev; replacement value for a player without a Stage 1 value), over every stint of audit-accepted games in seasons 2012 to 2020; ties keep the earlier cell (λ, then ρ, ascending)",
      table,
      chosen,
      onEdge: { lambda: onLambdaEdge(chosen), rho: chosen.rho === rhos[0] || chosen.rho === rhos[rhos.length - 1] },
      chosenVsStage1: { ratio: chosen.forwardLoss / stage1Forward, improvement: 1 - chosen.forwardLoss / stage1Forward },
      chosenBySeason: forwardBySeason(chosenRun.forward, chosenCollection.index),
      profileLambda,
      profileRho,
      otherCriteria: { gameRmse: { ...byGame, onEdge: onLambdaEdge(byGame) }, endpointRmse: { ...byEndpoint, onEdge: onLambdaEdge(byEndpoint) } },
    },
    teamLine,
    trainingPairs: targets.length,
    teamTrainingRmse: rmseOfPredictions(predictTargets(rows, teamLine)),
    teamRmseLeaveSeasonOut: leaveSeasonOutRmse(rows),
    gameLine: { ...gameLine, games: gameRows.length, trainingRmse: rmseOfResiduals(gameResiduals), trainingMae: maeOfResiduals(gameResiduals) },
  };
}

function main(): void {
  if (process.argv.slice(2).length > 0) throw new Error("fit-stage2.ts takes no arguments: the training era is fixed.");
  const started = Date.now();
  const fit = runStage2Fit({ log: (line) => console.log(line) });
  writeJson(FIT_STAGE2_PATH, fit);
  console.log(`[fit-stage2] wrote ${FIT_STAGE2_PATH} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

if (process.argv[1]?.endsWith("fit-stage2.ts")) {
  try {
    main();
  } catch (error) {
    console.error(`[fit-stage2] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
