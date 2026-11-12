// Runs the Stage 2 test of the 548 score (docs/score/registration-stage2.md) with the
// frozen values in docs/score/fit-stage2.json and Stage 1's in docs/score/fit.json.
//
//   --era training   any time; seasons up to 2019-20 only, never a later season. Writes
//                    docs/score/evaluation-stage2-training.json. In-sample for the lines.
//   --era test       only while both freezes hold (Stage 1's docs/score/freeze.json and
//                    Stage 2's docs/score/freeze-stage2.json), checked before any test
//                    season is read. Writes docs/score/evaluation-stage2.json.
//
// Pass, both required: (1) season-to-season RMSE of Stage 2 below Stage 1's over the test
// team-seasons, each with its frozen line; (2) forward stint loss of Stage 2 below Stage
// 1's over the stints of the test seasons' audit-accepted games, each stint predicted from
// the ratings held at the latest checkpoint before its game, with h fixed at Stage 1's home
// term. The game-level check and everything else are reported and do not gate.
//
// Run: corepack pnpm exec tsx scripts/score/evaluate-stage2.ts --era training|test

import * as fs from "node:fs";
import type { TeamLine } from "../../src/lib/score/book";
import type { RapmPlayer } from "../../src/lib/score/rapm";
import type { ScoreGame } from "../../src/lib/score/types";
import {
  DEFAULT_FREEZE_PATHS,
  EVALUATION_PATH,
  FIRST_SEASON,
  LAST_TEST_SEASON,
  LAST_TRAINING_SEASON,
  TEST_RAPM_WINDOWS,
  TEST_TARGET_SEASONS,
  TRAINING_RAPM_WINDOWS,
  TRAINING_TARGET_SEASONS,
  coverage,
  inputHashes,
  leaveSeasonOutRmse,
  loadSeasons,
  loadTrainingGames,
  ownerChecks,
  range,
  seasonFacts,
  targetRows,
  teamTargets,
  windowRapm,
  writeJson,
  type FreezePaths,
  type FreezeRecord,
  type GameLoader,
  type OwnerGroup,
  type SeasonCoverage,
  type SeasonFacts,
} from "./score-data";
import { EXPECTED_TEST_TEAM_SEASONS } from "./evaluate-score";
import type { Stage2Fit } from "./fit-stage2";
import {
  DELTA_MIN_MINUTES,
  EVALUATION_STAGE2_PATH,
  FACE_MIN_MINUTES,
  FACE_SEASON,
  FIT_STAGE2_PATH,
  RECORD_MIN_MINUTES,
  STAGE2_FREEZE_PATHS,
  TRAINING_EVALUATION_STAGE2_PATH,
  assertStage2Frozen,
  athleteNames,
  bootstrapForwardRatio,
  bootstrapRmseRatio,
  collectOnCourt,
  correlation,
  deltaSize,
  endBoxValues,
  endRatings,
  extremes,
  forwardBySeason,
  forwardSummary,
  leaveSeasonOutGameRmse,
  loadStage1,
  maeOfResiduals,
  residuals,
  restrictToQualifying,
  rmseOfResiduals,
  seasonLines,
  slopeOf,
  stage2PassConditions,
  topByRating,
  type DeltaSize,
  type ForwardSeason,
  type ForwardSummary,
  type LossRatioInterval,
  type PlayerLine,
  type RmseRatioInterval,
  type Slope,
  type Stage1Inputs,
  type Stage2Pass,
} from "./stage2-data";
import { loadScoreGames } from "./store";

export type Era = "training" | "test";

type Pair = { stage2: number; stage1: number };

export type Stage2Evaluation = {
  era: Era;
  freeze: { stage1: FreezeRecord; stage2: FreezeRecord } | null;
  /** The second use of the test seasons: Stage 1's test already read them once. */
  testSeasonUse: string;
  inputs: { files: Record<string, string>; combined: string };
  stage1FitSha256: string;
  params: { lambda: number; rho: number };
  coverage: SeasonCoverage[];
  targetSeasons: number[];
  teamSeasons: number;
  expectedTeamSeasons: number | null;
  /** The two pass conditions (team RMSE with the frozen lines, forward stint loss), and the overall result. */
  endpoint: Stage2Pass;
  /** The forward stint loss over the era's target seasons, per season, and γ for the record. */
  forward: ForwardSummary & { home: number; bySeason: ForwardSeason[]; slope: { stage1: Slope; stage2: Slope } };
  team: { rmse: Pair; rmseLeaveSeasonOut: Pair | null };
  /** Reported, not gating. */
  game: { games: number; rmse: Pair; meanAbsoluteError: Pair; rmseLeaveSeasonOut: Pair | null };
  /** Training only: the pass rule with the team condition on leave-one-season-out errors (the forward loss fits nothing). */
  endpointLeaveSeasonOut: Stage2Pass | null;
  /** Checks that the walk's Stage 1 numbers equal Stage 1's recorded ones. */
  stage1Reproduced: { team: { here: number; recorded: number }; gameMae: { here: number; recorded: number } };
  bootstrap: {
    forwardByGame: LossRatioInterval;
    forwardBySeason: LossRatioInterval;
    teamBySeason: RmseRatioInterval;
    teamByTeamSeason: RmseRatioInterval;
    gameBySeason: RmseRatioInterval;
  };
  deltaSize: DeltaSize;
  /** δ against (three-season RAPM total − Stage 1 value), player-seasons with ≥ 1,000 minutes. */
  deltaVsRapm: { playerSeasons: number; correlation: number; boxVsRapm: number; ratingVsRapm: number };
  ownerChecks: Array<{
    group: OwnerGroup;
    size: number;
    stage2: number | null;
    stage1: number | null;
    stage2Mapped: number | null;
    stage1Mapped: number | null;
  }>;
  /** Training only: the end of 2019-20. */
  faceValidity: { season: number; minMinutes: number; positive: PlayerLine[]; negative: PlayerLine[]; topRating: PlayerLine[] } | null;
  /** Test only: for the record, the largest δ at the end of each test season. */
  record: Array<{ season: number; minMinutes: number; positive: PlayerLine[]; negative: PlayerLine[] }> | null;
  teams: Array<{ teamId: string; season: number; actual: number; stage2: number; stage1: number }>;
};

export type Stage2EvaluateOptions = {
  era: Era;
  loader?: GameLoader;
  /** Training only: a fit and Stage 1 passed in (tests). A test-era run reads the frozen files. */
  fit?: Stage2Fit;
  stage1?: Stage1Inputs;
  freezePaths?: { stage1: FreezePaths; stage2: FreezePaths };
};

function loadStage2Fit(file: string): Stage2Fit {
  if (!fs.existsSync(file)) throw new Error(`${file} is missing: run fit-stage2.ts first.`);
  return JSON.parse(fs.readFileSync(file, "utf-8")) as Stage2Fit;
}

export const TEST_SEASON_USE =
  "Second use of the test seasons 2021 to 2026: Stage 1's registered test read them once, and its aggregate results were known to the builders. Stage 2's choices come from the training era only. The clean prospective check is the live 2026-27 season.";

export function runStage2Evaluation(options: Stage2EvaluateOptions): Stage2Evaluation {
  const { era } = options;
  if (era !== "training" && era !== "test") throw new Error(`Unknown era "${String(era)}".`);
  // The guard comes first: nothing below may read a test season without both freezes.
  const paths = options.freezePaths ?? { stage1: DEFAULT_FREEZE_PATHS, stage2: STAGE2_FREEZE_PATHS };
  const freeze = era === "test" ? assertStage2Frozen(paths.stage2, paths.stage1) : null;
  if (era === "test" && (options.fit || options.stage1)) throw new Error("A test-era run reads the frozen fit files, never a fit passed in.");
  const fit = options.fit ?? loadStage2Fit(era === "test" ? paths.stage2.fit : FIT_STAGE2_PATH);
  const stage1 = options.stage1 ?? loadStage1(era === "test" ? paths.stage1.fit : undefined);
  if (fit.stage1.fitSha256 !== stage1.fitSha256) {
    throw new Error(`fit-stage2.json was fitted on another Stage 1 fit (${fit.stage1.fitSha256} ≠ ${stage1.fitSha256}).`);
  }
  const loader = options.loader ?? loadScoreGames;
  const seasons = era === "test" ? range(FIRST_SEASON, LAST_TEST_SEASON) : range(FIRST_SEASON, LAST_TRAINING_SEASON);
  const games: ScoreGame[] = era === "test" ? loadSeasons(seasons, loader) : loadTrainingGames(seasons, loader);
  const targetSeasons = (era === "test" ? [...TEST_TARGET_SEASONS] : [...TRAINING_TARGET_SEASONS]).filter((season) =>
    seasons.includes(season - 1),
  );
  const windows = era === "test" ? TEST_RAPM_WINDOWS : TRAINING_RAPM_WINDOWS;
  const params = { lambda: fit.tuning.chosen.lambda, rho: fit.tuning.chosen.rho };

  const facts = new Map<number, SeasonFacts>(seasons.map((season) => [season, seasonFacts(games, season)]));
  const targets = teamTargets(facts, targetSeasons);
  const seasonsN = targetSeasons.map((season) => season - 1);
  const collection = collectOnCourt(games, stage1, [params], targetSeasons);

  // Season-to-season, frozen lines.
  const stage2Rows = targetRows(targets, restrictToQualifying(endRatings(collection, 0, seasonsN), facts));
  const stage1Rows = targetRows(targets, restrictToQualifying(endBoxValues(collection, seasonsN), facts));
  const stage1TeamLine: TeamLine = stage1.fit.teamLines.score;
  const teamResiduals = { stage2: residuals(stage2Rows, fit.teamLine), stage1: residuals(stage1Rows, stage1TeamLine) };
  const teamRmse = { stage2: rmseOfResiduals(teamResiduals.stage2), stage1: rmseOfResiduals(teamResiduals.stage1) };

  // Game level, frozen lines.
  const stage1GameLine: TeamLine = stage1.fit.gameLines.score;
  const gameResiduals = {
    stage2: residuals(collection.gameRows[0], fit.gameLine),
    stage1: residuals(collection.stage1GameRows, stage1GameLine),
  };
  const gameRmse = { stage2: rmseOfResiduals(gameResiduals.stage2), stage1: rmseOfResiduals(gameResiduals.stage1) };
  const gameMae = { stage2: maeOfResiduals(gameResiduals.stage2), stage1: maeOfResiduals(gameResiduals.stage1) };

  const training = era === "training";
  const teamLoso = training ? { stage2: leaveSeasonOutRmse(stage2Rows), stage1: leaveSeasonOutRmse(stage1Rows) } : null;
  const gameLoso = training
    ? { stage2: leaveSeasonOutGameRmse(collection.gameRows[0]), stage1: leaveSeasonOutGameRmse(collection.stage1GameRows) }
    : null;

  // Forward stint loss: nothing is fitted, so the same numbers stand in and out of sample.
  const forwardResult = { ...forwardSummary(collection.forward, 0), home: collection.forward.home, bySeason: forwardBySeason(collection.forward, 0) };
  const forwardPair = { stage2: forwardResult.stage2, stage1: forwardResult.stage1 };

  const seed = `548-stage2-bootstrap-${era}`;
  const bootstrap = {
    forwardByGame: bootstrapForwardRatio(collection.forward, 0, "game", `${seed}-forward-game`),
    forwardBySeason: bootstrapForwardRatio(collection.forward, 0, "season", `${seed}-forward-season-cluster`),
    teamBySeason: bootstrapRmseRatio(teamResiduals.stage2, teamResiduals.stage1, "season", `${seed}-team-season-cluster`),
    teamByTeamSeason: bootstrapRmseRatio(teamResiduals.stage2, teamResiduals.stage1, "unit", `${seed}-team-season`),
    gameBySeason: bootstrapRmseRatio(gameResiduals.stage2, gameResiduals.stage1, "season", `${seed}-game-season-cluster`),
  };

  // The size of δ over the era's seasons (training 2011-2020, test 2021-2026), end of each.
  const eraSeasons = training ? seasons : [...TEST_TARGET_SEASONS];
  const size = deltaSize(collection, 0, eraSeasons, facts, DELTA_MIN_MINUTES);

  // RAPM windows of the era, for δ against RAPM and the owner checks.
  const rapmBySeason = new Map<number, Map<string, RapmPlayer>>();
  for (const window of windows) {
    if (!window.every((season) => seasons.includes(season))) continue;
    const players = windowRapm(games, window, stage1.fit.rapm.frozenPenalties);
    for (const season of window) rapmBySeason.set(season, players);
  }
  const checkSeasons = [...rapmBySeason.keys()].sort((a, b) => a - b);
  const deltas: number[] = [];
  const gaps: number[] = [];
  const boxes: number[] = [];
  const ratings: number[] = [];
  const rapmTotals: number[] = [];
  for (const season of checkSeasons) {
    const end = collection.ends.get(season);
    const minutes = facts.get(season)?.minutes;
    const rapm = rapmBySeason.get(season);
    if (!end || !minutes || !rapm) throw new Error(`Season ${season} is missing.`);
    for (const [id, played] of [...minutes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (played < DELTA_MIN_MINUTES) continue;
      const b = end.box.get(id);
      const total = rapm.get(id)?.total;
      if (b === undefined || total === undefined) continue;
      const d = end.delta[0].get(id) ?? 0;
      deltas.push(d);
      gaps.push(total - b);
      boxes.push(b);
      ratings.push(b + d);
      rapmTotals.push(total);
    }
  }
  const deltaVsRapm = {
    playerSeasons: deltas.length,
    correlation: correlation(deltas, gaps),
    boxVsRapm: correlation(boxes, rapmTotals),
    ratingVsRapm: correlation(ratings, rapmTotals),
  };

  const stage2Values = endRatings(collection, 0, checkSeasons);
  const stage1Values = endBoxValues(collection, checkSeasons);
  const forward = ownerChecks(facts, checkSeasons, rapmBySeason, stage2Values, stage1Values, fit.teamLine, stage1TeamLine);
  const backward = ownerChecks(facts, checkSeasons, rapmBySeason, stage1Values, stage2Values, stage1TeamLine, fit.teamLine);
  const owner = forward.map((row, i) => ({
    group: row.group,
    size: row.size,
    stage2: row.score,
    stage1: backward[i].score,
    stage2Mapped: row.scoreMapped,
    stage1Mapped: row.comparatorMapped,
  }));

  const names = athleteNames(games);
  let faceValidity: Stage2Evaluation["faceValidity"] = null;
  let record: Stage2Evaluation["record"] = null;
  if (training && seasons.includes(FACE_SEASON)) {
    const lines = seasonLines(collection, 0, FACE_SEASON, facts, names, FACE_MIN_MINUTES);
    faceValidity = { season: FACE_SEASON, minMinutes: FACE_MIN_MINUTES, ...extremes(lines), topRating: topByRating(lines) };
  }
  if (!training) {
    record = [...TEST_TARGET_SEASONS].map((season) => ({
      season,
      minMinutes: RECORD_MIN_MINUTES,
      ...extremes(seasonLines(collection, 0, season, facts, names, RECORD_MIN_MINUTES)),
    }));
  }

  const stage1Recorded = training
    ? stage1.fit.trainingRmse.score
    : (JSON.parse(fs.readFileSync(EVALUATION_PATH, "utf-8")) as { rmse: { score: number } }).rmse.score;
  const stage1RecordedMae = training
    ? stage1.fit.gameLines.score.trainingMae
    : (JSON.parse(fs.readFileSync(EVALUATION_PATH, "utf-8")) as { gameLevel: { score: { meanAbsoluteError: number } } }).gameLevel.score
        .meanAbsoluteError;

  return {
    era,
    freeze,
    testSeasonUse: training ? "Training era only; no test season was read." : TEST_SEASON_USE,
    inputs: options.loader ? { files: {}, combined: "injected loader" } : inputHashes(seasons),
    stage1FitSha256: stage1.fitSha256,
    params,
    coverage: coverage(games),
    targetSeasons,
    teamSeasons: targets.length,
    expectedTeamSeasons: training ? null : EXPECTED_TEST_TEAM_SEASONS,
    endpoint: stage2PassConditions(teamRmse, forwardPair),
    forward: { ...forwardResult, slope: { stage1: slopeOf(collection.forward.slopeStage1), stage2: slopeOf(collection.forward.slopeStage2[0]) } },
    team: { rmse: teamRmse, rmseLeaveSeasonOut: teamLoso },
    game: { games: collection.gameRows[0].length, rmse: gameRmse, meanAbsoluteError: gameMae, rmseLeaveSeasonOut: gameLoso },
    endpointLeaveSeasonOut: teamLoso ? stage2PassConditions(teamLoso, forwardPair) : null,
    stage1Reproduced: { team: { here: teamRmse.stage1, recorded: stage1Recorded }, gameMae: { here: gameMae.stage1, recorded: stage1RecordedMae } },
    bootstrap,
    deltaSize: size,
    deltaVsRapm,
    ownerChecks: owner,
    faceValidity,
    record,
    teams: targets.map((target, i) => ({
      teamId: target.teamId,
      season: target.season,
      actual: target.actual,
      stage2: target.actual - teamResiduals.stage2[i].error,
      stage1: target.actual - teamResiduals.stage1[i].error,
    })),
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
  const started = Date.now();
  const evaluation = runStage2Evaluation({ era });
  const file = era === "test" ? EVALUATION_STAGE2_PATH : TRAINING_EVALUATION_STAGE2_PATH;
  writeJson(file, evaluation);
  const { endpoint } = evaluation;
  const verdict = (passed: boolean) => (passed ? "holds" : "fails");
  console.log(
    `[evaluate-stage2] ${era}: λ ${evaluation.params.lambda}, ρ ${evaluation.params.rho}; ${evaluation.teamSeasons} team-seasons, ${evaluation.game.games} games\n` +
      `  (1) team RMSE Stage 2 ${endpoint.team.rmseStage2.toFixed(4)} < Stage 1 ${endpoint.team.rmseStage1.toFixed(4)}: ${verdict(endpoint.team.passed)}\n` +
      `  (2) forward stint loss Stage 2 ${endpoint.forward.lossStage2.toFixed(3)} < Stage 1 ${endpoint.forward.lossStage1.toFixed(3)}: ${verdict(endpoint.forward.passed)}\n` +
      `  reported: game RMSE Stage 2 ${evaluation.game.rmse.stage2.toFixed(4)}, Stage 1 ${evaluation.game.rmse.stage1.toFixed(4)}\n` +
      `  overall: ${endpoint.passed ? "PASS" : "FAIL"}`,
  );
  console.log(`[evaluate-stage2] wrote ${file} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

if (process.argv[1]?.endsWith("evaluate-stage2.ts")) {
  try {
    main();
  } catch (error) {
    console.error(`[evaluate-stage2] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
