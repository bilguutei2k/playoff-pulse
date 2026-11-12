// Fits Stage 1 of the 548 score on the training era only (seasons up to 2019-20) and
// writes docs/score/fit.json: RAPM penalties by window, the primary lineup-regression
// coefficients, the cross-check and role-aware variants, the book's φ, k and r, the
// straight-line maps of every metric, the game-level lines, coverage and input hashes.
//
// It refuses, in code, to load any season after 2020 (`loadTrainingGames`). Deterministic:
// seeded folds, sorted keys, no clock; the same built games give the same bytes.
//
// Run: corepack pnpm exec tsx scripts/score/fit-score.ts

import {
  fitTeamLine,
  type BookParams,
  type TeamLine,
} from "../../src/lib/score/book";
import {
  BOX_STATS,
  ROLE_STATS,
  buildSeasonTotals,
  crossValidateLineup,
  fitLineupModel,
  fitRapmTargetModel,
  lineupRows,
  rapmTargetRows,
  type BoxCoefficients,
  type PenaltyCvCell,
} from "../../src/lib/score/box-model";
import {
  buildRapmDesign,
  fitRapm,
  prepareRapmFolds,
  searchRapmPenalties,
  type RapmCvCell,
  type RapmPenalties,
  type RapmPlayer,
} from "../../src/lib/score/rapm";
import type { ScoreGame } from "../../src/lib/score/types";
import {
  BOOK_METRICS,
  COMPARATOR_METRICS,
  FIRST_SEASON,
  FIT_PATH,
  LAST_TRAINING_SEASON,
  MIN_PRIOR_MINUTES,
  TRAINING_RAPM_WINDOWS,
  TRAINING_TARGET_SEASONS,
  bookGameRows,
  comparatorGameRows,
  coverage,
  inputHashes,
  lastNetRows,
  loadTrainingGames,
  meanAbsoluteError,
  metricValues,
  predictTargets,
  range,
  rmseOf,
  rmseOfPredictions,
  seasonFacts,
  targetRows,
  teamTargets,
  tuneBook,
  writeJson,
  type BookTuning,
  type CoefficientSets,
  type GameLoader,
  type Metric,
  type SeasonCoverage,
  type SeasonFacts,
} from "./score-data";
import { loadScoreGames } from "./store";

export const FIT_VERSION = 1;

/** Settings of the fit itself, recorded in fit.json. */
export const FIT_SETTINGS = {
  folds: 5,
  rapmSeed: "548-rapm",
  rapmLadder: [250, 500, 1000, 2000, 4000, 8000, 16000],
  rapmStep: 2,
  lineupSeed: "548-lineup",
  lineupAlphas: [0, 1e-4, 1e-3, 1e-2, 1e-1],
  /** Role interactions take at least ten times the main penalty, and at least 0.01. */
  roleAlphas: [1e-2, 1e-1, 1, 10],
  roleMinimumMultiple: 10,
  crossCheckSeed: "548-cross-check",
  crossCheckAlphas: [0, 1e-3, 1e-2, 1e-1, 1],
  /** RAPM offence + defence possessions in the window for a cross-check row. */
  crossCheckMinPossessions: 5000,
} as const;

export type FitSettings = {
  folds: number;
  rapmSeed: string;
  rapmLadder: readonly number[];
  rapmStep: number;
  lineupSeed: string;
  lineupAlphas: readonly number[];
  roleAlphas: readonly number[];
  roleMinimumMultiple: number;
  crossCheckSeed: string;
  crossCheckAlphas: readonly number[];
  crossCheckMinPossessions: number;
};

type Named = Record<string, number>;

export type ScoreFit = {
  version: number;
  trainingSeasons: number[];
  inputs: { files: Record<string, string>; combined: string };
  settings: FitSettings;
  coverage: SeasonCoverage[];
  rapm: {
    windows: Array<{
      seasons: number[];
      players: number;
      rows: number;
      cells: RapmCvCell[];
      best: RapmPenalties & { loss: number };
      atLadderEdge: boolean;
      homeOffence: number;
    }>;
    /** Penalties for every later RAPM window (the latest training window's choice). */
    frozenPenalties: RapmPenalties;
  };
  primary: { rows: number; cv: PenaltyCvCell[]; alpha: number; home: number; beta: Named; meanSquaredError: number };
  roleAware: {
    rows: number;
    alpha: number;
    cv: PenaltyCvCell[];
    roleAlpha: number;
    home: number;
    beta: Named;
    role: Named;
  };
  crossCheck: {
    rows: number;
    minPossessions: number;
    cv: Array<{ alpha: number; loss: number }>;
    alpha: number;
    intercept: number;
    beta: Named;
  };
  book: BookTuning;
  minPriorMinutes: number;
  teamLines: Record<Metric | "lastSeasonNet", TeamLine>;
  trainingRmse: Record<Metric | "lastSeasonNet" | "allZero", number>;
  trainingPairs: number;
  gameLines: Record<"score" | "comparatorUnfloored" | "comparatorFloored", TeamLine & { trainingMae: number; games: number }>;
};

const named = (names: readonly string[], values: readonly number[]): Named =>
  Object.fromEntries(names.map((name, i) => [name, values[i]]));

export function coefficientsFromFit(fit: ScoreFit): CoefficientSets {
  return {
    score: { beta: BOX_STATS.map((stat) => fit.primary.beta[stat]) },
    crossCheck: { beta: BOX_STATS.map((stat) => fit.crossCheck.beta[stat]) },
    roleAware: {
      beta: BOX_STATS.map((stat) => fit.roleAware.beta[stat]),
      role: ROLE_STATS.map((stat) => fit.roleAware.role[stat]),
    },
    teamNetOnly: { beta: BOX_STATS.map(() => 0) },
  };
}

export function bookParamsFromFit(fit: ScoreFit): BookParams {
  const { decay, pseudoPossessions, replacement } = fit.book.chosen;
  return { decay, pseudoPossessions, replacement };
}

export type FitOptions = {
  loader?: GameLoader;
  settings?: FitSettings;
  /** Seasons to load; every one must be in the training era. */
  seasons?: readonly number[];
  log?: (line: string) => void;
};

export function runFit(options: FitOptions = {}): ScoreFit {
  const settings = options.settings ?? FIT_SETTINGS;
  const log = options.log ?? (() => {});
  const seasons = [...(options.seasons ?? range(FIRST_SEASON, LAST_TRAINING_SEASON))];
  const games: ScoreGame[] = loadTrainingGames(seasons, options.loader ?? loadScoreGames);
  log(`[fit] ${games.length} games, seasons ${seasons[0]}-${seasons[seasons.length - 1]}`);

  // RAPM by three-season window, penalties by cross-validation over games.
  const windows: ScoreFit["rapm"]["windows"] = [];
  const rapmByWindow: Array<{ seasons: readonly number[]; players: Map<string, RapmPlayer> }> = [];
  for (const window of TRAINING_RAPM_WINDOWS) {
    if (!window.every((season) => seasons.includes(season))) continue;
    const wanted = new Set(window);
    const design = buildRapmDesign(games.filter((game) => wanted.has(game.season)));
    const prepared = prepareRapmFolds(design, settings.folds, `${settings.rapmSeed}-${window.join("-")}`);
    const search = searchRapmPenalties(prepared, settings.rapmLadder, settings.rapmStep);
    const fit = fitRapm(design, { offence: search.best.offence, defence: search.best.defence });
    log(`[fit] RAPM ${window.join("-")}: ${design.athleteIds.length} players, λO ${search.best.offence}, λD ${search.best.defence}`);
    windows.push({
      seasons: [...window],
      players: design.athleteIds.length,
      rows: design.rowCount,
      cells: search.cells,
      best: search.best,
      atLadderEdge: search.atLadderEdge,
      homeOffence: fit.homeOffence,
    });
    rapmByWindow.push({ seasons: window, players: new Map(fit.players.map((p) => [p.athleteId, p])) });
  }
  if (windows.length === 0) throw new Error("No complete RAPM window in the loaded seasons.");
  const latest = windows[windows.length - 1].best;

  // Primary: lineup regression, ridge by cross-validation over games.
  const rows = lineupRows(games, { roleAware: false });
  const primaryCv = crossValidateLineup(
    rows,
    settings.lineupAlphas.map((alpha) => ({ alpha, roleAlpha: 0 })),
    settings.folds,
    settings.lineupSeed,
  );
  const primary = fitLineupModel(rows, { alpha: primaryCv.best.alpha, roleAlpha: 0 });
  log(`[fit] primary: ${rows.rowCount} stints, α ${primary.penalty.alpha}`);

  // Role-aware: same main penalty, stronger penalty on the interactions.
  const roleRows = lineupRows(games, { roleAware: true });
  const floor = Math.max(settings.roleAlphas[0], settings.roleMinimumMultiple * primary.penalty.alpha);
  const roleGrid = settings.roleAlphas.filter((alpha) => alpha >= floor);
  const roleCv = crossValidateLineup(
    roleRows,
    (roleGrid.length > 0 ? roleGrid : [floor]).map((roleAlpha) => ({ alpha: primary.penalty.alpha, roleAlpha })),
    settings.folds,
    settings.lineupSeed,
  );
  const role = fitLineupModel(roleRows, { alpha: primary.penalty.alpha, roleAlpha: roleCv.best.roleAlpha });

  // Cross-check: regression of window RAPM totals on within-team rates.
  const targetRowsAll = rapmByWindow.flatMap(({ seasons: window, players }) =>
    rapmTargetRows(
      window.map((season) => buildSeasonTotals(games, season)),
      players,
      settings.crossCheckMinPossessions,
    ),
  );
  const crossCheck = fitRapmTargetModel(targetRowsAll, settings.crossCheckAlphas, settings.folds, settings.crossCheckSeed);

  // The book and the straight-line maps, on training pairs only.
  const facts = new Map<number, SeasonFacts>(seasons.map((season) => [season, seasonFacts(games, season)]));
  const targetSeasons = TRAINING_TARGET_SEASONS.filter((season) => seasons.includes(season) && seasons.includes(season - 1));
  const targets = teamTargets(facts, targetSeasons);
  const primaryCoefficients: BoxCoefficients = { beta: primary.beta };
  const book = tuneBook(games, targets, facts, primaryCoefficients);
  const params: BookParams = { decay: book.chosen.decay, pseudoPossessions: book.chosen.pseudoPossessions, replacement: book.chosen.replacement };
  log(`[fit] book: φ ${params.decay}, k ${params.pseudoPossessions}, r ${params.replacement}`);

  const coefficientSets: CoefficientSets = {
    score: primaryCoefficients,
    crossCheck: { beta: crossCheck.beta },
    roleAware: { beta: role.beta, role: role.role },
    teamNetOnly: { beta: BOX_STATS.map(() => 0) },
  };
  const values = metricValues(games, targetSeasons.map((season) => season - 1), facts, coefficientSets, params);
  const teamLines = {} as ScoreFit["teamLines"];
  const trainingRmse = {} as ScoreFit["trainingRmse"];
  for (const metric of [...BOOK_METRICS, ...COMPARATOR_METRICS]) {
    const metricRows = targetRows(targets, values[metric]);
    teamLines[metric] = fitTeamLine(metricRows);
    trainingRmse[metric] = rmseOfPredictions(predictTargets(metricRows, teamLines[metric]));
  }
  const lastRows = lastNetRows(targets);
  teamLines.lastSeasonNet = fitTeamLine(lastRows);
  trainingRmse.lastSeasonNet = rmseOfPredictions(predictTargets(lastRows, teamLines.lastSeasonNet));
  trainingRmse.allZero = rmseOf(targets.map((target) => target.actual));

  // Game level: home term and scale per metric, values held before each game.
  const gameSeasons = targetSeasons;
  const gameRowsBy = {
    score: bookGameRows(games, gameSeasons, primaryCoefficients, params),
    comparatorUnfloored: comparatorGameRows(games, gameSeasons, false),
    comparatorFloored: comparatorGameRows(games, gameSeasons, true),
  };
  const gameLines = {} as ScoreFit["gameLines"];
  for (const metric of ["score", "comparatorUnfloored", "comparatorFloored"] as const) {
    const line = fitTeamLine(gameRowsBy[metric]);
    gameLines[metric] = { ...line, trainingMae: meanAbsoluteError(gameRowsBy[metric], line), games: gameRowsBy[metric].length };
  }

  return {
    version: FIT_VERSION,
    trainingSeasons: seasons,
    inputs: options.loader ? { files: {}, combined: "injected loader" } : inputHashes(seasons),
    settings: {
      ...settings,
      rapmLadder: [...settings.rapmLadder],
      lineupAlphas: [...settings.lineupAlphas],
      roleAlphas: [...settings.roleAlphas],
      crossCheckAlphas: [...settings.crossCheckAlphas],
    },
    coverage: coverage(games),
    rapm: { windows, frozenPenalties: { offence: latest.offence, defence: latest.defence } },
    primary: {
      rows: rows.rowCount,
      cv: primaryCv.cells,
      alpha: primary.penalty.alpha,
      home: primary.home,
      beta: named(BOX_STATS, primary.beta),
      meanSquaredError: primary.meanSquaredError,
    },
    roleAware: {
      rows: roleRows.rowCount,
      alpha: role.penalty.alpha,
      cv: roleCv.cells,
      roleAlpha: role.penalty.roleAlpha,
      home: role.home,
      beta: named(BOX_STATS, role.beta),
      role: named(ROLE_STATS, role.role ?? []),
    },
    crossCheck: {
      rows: crossCheck.rows,
      minPossessions: settings.crossCheckMinPossessions,
      cv: crossCheck.cv,
      alpha: crossCheck.alpha,
      intercept: crossCheck.intercept,
      beta: named(BOX_STATS, crossCheck.beta),
    },
    book,
    minPriorMinutes: MIN_PRIOR_MINUTES,
    teamLines,
    trainingRmse,
    trainingPairs: targets.length,
    gameLines,
  };
}

function main(): void {
  if (process.argv.slice(2).length > 0) throw new Error("fit-score.ts takes no arguments: the training era is fixed.");
  const fit = runFit({ log: (line) => console.log(line) });
  writeJson(FIT_PATH, fit);
  console.log(`[fit] wrote ${FIT_PATH}`);
}

if (process.argv[1]?.endsWith("fit-score.ts")) {
  try {
    main();
  } catch (error) {
    console.error(`[fit] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
