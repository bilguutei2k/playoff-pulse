// Runs the Stage 1 test of the 548 score (docs/score/registration.md) with the frozen
// values in docs/score/fit.json.
//
//   --era training   any time; training pairs (N + 1 ≤ 2020) only, never a later season.
//                    Writes docs/score/evaluation-training.json. In-sample for the lines.
//   --era test       only while docs/score/freeze.json exists and both of its hashes match
//                    the registration and fit files; checked before any test season is
//                    read. Writes docs/score/evaluation.json with those hashes.
//
// Endpoint: RMSE over team-seasons N + 1 of a + b × Σ share × v + c × u against the team's
// net rating in N + 1. Pass: RMSE(score) ≤ 0.90 × RMSE(comparator, unfloored). Everything
// else is reported and does not gate.
//
// Run: corepack pnpm exec tsx scripts/score/evaluate-score.ts --era training|test

import * as fs from "node:fs";
import type { TeamLine } from "../../src/lib/score/book";
import type { RapmPlayer } from "../../src/lib/score/rapm";
import type { ScoreGame } from "../../src/lib/score/types";
import { bookParamsFromFit, coefficientsFromFit, type ScoreFit } from "./fit-score";
import {
  BAR,
  BOOK_METRICS,
  COMPARATOR_METRICS,
  DEFAULT_FREEZE_PATHS,
  EVALUATION_PATH,
  FIRST_SEASON,
  FIT_PATH,
  LAST_TEST_SEASON,
  LAST_TRAINING_SEASON,
  TEST_RAPM_WINDOWS,
  TEST_TARGET_SEASONS,
  TRAINING_EVALUATION_PATH,
  TRAINING_RAPM_WINDOWS,
  TRAINING_TARGET_SEASONS,
  assertFrozen,
  bookGameRows,
  bootstrapRatio,
  comparatorGameRows,
  coverage,
  inputHashes,
  lastNetRows,
  loadSeasons,
  loadTrainingGames,
  meanAbsoluteError,
  metricValues,
  ownerCheckValues,
  ownerChecks,
  predictTargets,
  range,
  rmseOf,
  rmseOfPredictions,
  seasonFacts,
  targetRows,
  teamTargets,
  windowRapm,
  writeJson,
  type FreezePaths,
  type FreezeRecord,
  type GameLoader,
  type Metric,
  type OwnerCheckResult,
  type RatioInterval,
  type SeasonCoverage,
  type SeasonFacts,
  type TeamPrediction,
} from "./score-data";
import { loadScoreGames } from "./store";

export type Era = "training" | "test";

export const EXPECTED_TEST_TEAM_SEASONS = 180;

export type ScoreEvaluation = {
  era: Era;
  freeze: FreezeRecord | null;
  inputs: { files: Record<string, string>; combined: string };
  coverage: SeasonCoverage[];
  targetSeasons: number[];
  teamSeasons: number;
  expectedTeamSeasons: number | null;
  endpoint: {
    rmseScore: number;
    rmseComparator: number;
    ratio: number;
    bar: number;
    passed: boolean;
  };
  rmse: Record<Metric | "lastSeasonNet" | "allZero", number>;
  bootstrap: { teamSeason: RatioInterval; season: RatioInterval };
  roleAwareGap: number;
  gameLevel: Record<"score" | "comparatorUnfloored" | "comparatorFloored", { games: number; meanAbsoluteError: number }>;
  ownerChecks: OwnerCheckResult[];
  /** Every team-season's actual and predictions, for audit. */
  teams: Array<{ teamId: string; season: number; actual: number } & Record<Metric | "lastSeasonNet", number>>;
};

export type EvaluateOptions = {
  era: Era;
  loader?: GameLoader;
  fit?: ScoreFit;
  freezePaths?: FreezePaths;
};

function loadFit(file: string): ScoreFit {
  if (!fs.existsSync(file)) throw new Error(`${file} is missing: run fit-score.ts first.`);
  return JSON.parse(fs.readFileSync(file, "utf-8")) as ScoreFit;
}

/** Runs the evaluation. A test-era run checks the freeze before reading any season. */
export function runEvaluation(options: EvaluateOptions): ScoreEvaluation {
  const { era } = options;
  if (era !== "training" && era !== "test") throw new Error(`Unknown era "${String(era)}".`);
  // The guard comes first: nothing below may read a test season without a valid freeze.
  const paths = options.freezePaths ?? DEFAULT_FREEZE_PATHS;
  const freeze = era === "test" ? assertFrozen(paths) : null;
  // A test-era run reads the fit only from the file whose hash was just checked.
  if (era === "test" && options.fit) throw new Error("A test-era run reads the frozen fit file, never a fit passed in.");
  const fit = options.fit ?? loadFit(era === "test" ? paths.fit : FIT_PATH);
  const loader = options.loader ?? loadScoreGames;
  const seasons = era === "test" ? range(FIRST_SEASON, LAST_TEST_SEASON) : range(FIRST_SEASON, LAST_TRAINING_SEASON);
  const games: ScoreGame[] = era === "test" ? loadSeasons(seasons, loader) : loadTrainingGames(seasons, loader);
  const targetSeasons = (era === "test" ? [...TEST_TARGET_SEASONS] : [...TRAINING_TARGET_SEASONS]).filter(
    (season) => seasons.includes(season - 1),
  );
  const windows = era === "test" ? TEST_RAPM_WINDOWS : TRAINING_RAPM_WINDOWS;

  const coefficients = coefficientsFromFit(fit);
  const params = bookParamsFromFit(fit);
  const facts = new Map<number, SeasonFacts>(seasons.map((season) => [season, seasonFacts(games, season)]));
  const targets = teamTargets(facts, targetSeasons);
  const values = metricValues(games, targetSeasons.map((season) => season - 1), facts, coefficients, params);

  const predictions = {} as Record<Metric | "lastSeasonNet", TeamPrediction[]>;
  const rmse = {} as ScoreEvaluation["rmse"];
  for (const metric of [...BOOK_METRICS, ...COMPARATOR_METRICS]) {
    predictions[metric] = predictTargets(targetRows(targets, values[metric]), fit.teamLines[metric]);
    rmse[metric] = rmseOfPredictions(predictions[metric]);
  }
  predictions.lastSeasonNet = predictTargets(lastNetRows(targets), fit.teamLines.lastSeasonNet);
  rmse.lastSeasonNet = rmseOfPredictions(predictions.lastSeasonNet);
  rmse.allZero = rmseOf(targets.map((target) => target.actual));

  const ratio = rmse.score / rmse.comparatorUnfloored;
  const seed = `548-bootstrap-${era}`;
  const bootstrap = {
    teamSeason: bootstrapRatio(predictions.score, predictions.comparatorUnfloored, "team-season", `${seed}-team-season`),
    season: bootstrapRatio(predictions.score, predictions.comparatorUnfloored, "season", `${seed}-season`),
  };

  // Game level, with the frozen home term and scale of each metric.
  const gameRows = {
    score: bookGameRows(games, targetSeasons, coefficients.score, params),
    comparatorUnfloored: comparatorGameRows(games, targetSeasons, false),
    comparatorFloored: comparatorGameRows(games, targetSeasons, true),
  };
  const gameLevel = {} as ScoreEvaluation["gameLevel"];
  for (const metric of ["score", "comparatorUnfloored", "comparatorFloored"] as const) {
    const line: TeamLine = fit.gameLines[metric];
    gameLevel[metric] = { games: gameRows[metric].length, meanAbsoluteError: meanAbsoluteError(gameRows[metric], line) };
  }

  // Owner checks on player-seasons of the era, against the RAPM window containing each season.
  const rapmBySeason = new Map<number, Map<string, RapmPlayer>>();
  for (const window of windows) {
    if (!window.every((season) => seasons.includes(season))) continue;
    const players = windowRapm(games, window, fit.rapm.frozenPenalties);
    for (const season of window) rapmBySeason.set(season, players);
  }
  const checkSeasons = [...rapmBySeason.keys()].sort((a, b) => a - b);
  const checkValues = ownerCheckValues(games, checkSeasons, coefficients.score, params);
  const owner = ownerChecks(
    facts,
    checkSeasons,
    rapmBySeason,
    checkValues.score,
    checkValues.comparator,
    fit.teamLines.score,
    fit.teamLines.comparatorUnfloored,
  );

  const metrics = [...BOOK_METRICS, ...COMPARATOR_METRICS, "lastSeasonNet"] as const;
  const teams = targets.map((target, index) => {
    const row = { teamId: target.teamId, season: target.season, actual: target.actual } as ScoreEvaluation["teams"][number];
    for (const metric of metrics) row[metric] = predictions[metric][index].predicted;
    return row;
  });

  return {
    era,
    freeze,
    inputs: options.loader ? { files: {}, combined: "injected loader" } : inputHashes(seasons),
    coverage: coverage(games),
    targetSeasons,
    teamSeasons: targets.length,
    expectedTeamSeasons: era === "test" ? EXPECTED_TEST_TEAM_SEASONS : null,
    endpoint: {
      rmseScore: rmse.score,
      rmseComparator: rmse.comparatorUnfloored,
      ratio,
      bar: BAR,
      passed: ratio <= BAR,
    },
    rmse,
    bootstrap,
    roleAwareGap: rmse.roleAware - rmse.score,
    gameLevel,
    ownerChecks: owner,
    teams,
  };
}

function parseEra(argv: readonly string[]): Era {
  const index = argv.indexOf("--era");
  const era = index >= 0 ? argv[index + 1] : undefined;
  if (era !== "training" && era !== "test") throw new Error("Pass --era training or --era test.");
  return era;
}

function main(): void {
  const era = parseEra(process.argv.slice(2));
  const evaluation = runEvaluation({ era });
  const file = era === "test" ? EVALUATION_PATH : TRAINING_EVALUATION_PATH;
  writeJson(file, evaluation);
  const { endpoint } = evaluation;
  console.log(
    `[evaluate] ${era}: ${evaluation.teamSeasons} team-seasons, RMSE score ${endpoint.rmseScore.toFixed(3)}, ` +
      `comparator ${endpoint.rmseComparator.toFixed(3)}, ratio ${endpoint.ratio.toFixed(3)} (bar ${endpoint.bar}): ` +
      `${endpoint.passed ? "PASS" : "FAIL"}`,
  );
  console.log(`[evaluate] wrote ${file}`);
}

if (process.argv[1]?.endsWith("evaluate-score.ts")) {
  try {
    main();
  } catch (error) {
    console.error(`[evaluate] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
