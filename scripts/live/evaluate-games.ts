// Scores frozen parameters on validation seasons. Game-level gates G1-G3 use
// 2016-2022 regular seasons; 2023-2026 is reported separately because a spike on
// those seasons informed the choice of model form.
//
// Run: corepack pnpm exec tsx scripts/live/evaluate-games.ts

import * as fs from "node:fs";
import * as path from "node:path";
import { solveSeriesExactly } from "../../src/lib/model/series-solver";
import { LIVE_MODEL_VERSION, LIVE_PARAMS } from "../../src/lib/season/params";
import { predictGame, replayRatings, type FilterState } from "../../src/lib/season/ratings";
import { teamIdFromRepoCode } from "../../src/lib/season/teams";
import type { GameContext, SeasonGame } from "../../src/lib/season/types";
import {
  eloPredictions,
  homeRatePredictions,
  srsToDatePredictions,
} from "./comparators";
import {
  calibrationFit,
  pairedSeasonBootstrap,
  reliability,
  round,
  summarize,
  type ScoredGame,
} from "./eval-metrics";
import { compareGames, loadHistory } from "./game-store";

const GATE_SEASONS = [2016, 2017, 2018, 2019, 2020, 2021, 2022];
const SEPARATE_SEASONS = [2023, 2024, 2025, 2026];

const development = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "docs/live/development-fit.json"), "utf-8"),
) as {
  comparatorParams: {
    elo: { k: number; hca: number; carry: number };
    srs: { ridge: number; hca: number; scale: number };
  };
};

const history = loadHistory(2026).sort(compareGames);
const kindById = new Map(history.map((game) => [game.id, game]));

function isIn(rows: ScoredGame[], seasons: number[], kind: SeasonGame["kind"]): ScoredGame[] {
  const allowed = new Set(seasons);
  return rows.filter(
    (row) => allowed.has(row.season) && kindById.get(row.id)?.kind === kind,
  );
}

// ---------------------------------------------------------------------------
// Game predictions, plus the state at each playoff series' first game
// ---------------------------------------------------------------------------

type SeriesStart = {
  season: number;
  round: string;
  homeCourtId: string;
  otherId: string;
  neutral: boolean;
  probabilityHomeCourt: number;
};

function seriesKey(season: number, a: string, b: string): string {
  return `${season}:${[a, b].sort().join("-")}`;
}

function seriesProbability(game: SeasonGame, state: FilterState): number {
  const home = game.homeId;
  const away = game.awayId;
  const contextFor = (homeId: string, awayId: string): GameContext => ({
    homeId,
    awayId,
    neutral: game.neutral,
    playoff: true,
    homeOnBackToBack: false,
    awayOnBackToBack: false,
  });
  const atHome = predictGame(state, contextFor(home, away), LIVE_PARAMS).homeWinProbability;
  const onRoad = 1 - predictGame(state, contextFor(away, home), LIVE_PARAMS).homeWinProbability;
  // Finals used 2-3-2 through 2013; everything else here is 2-2-1-1-1.
  const twoThreeTwo = game.round === "finals" && game.season <= 2013;
  const pattern = twoThreeTwo
    ? [true, true, false, false, false, true, true]
    : [true, true, false, false, true, false, true];
  return solveSeriesExactly(0, 0, (gameNumber) =>
    pattern[gameNumber - 1] ? atHome : onRoad,
  ).teamAWinProbability;
}

const seriesStarts = new Map<string, SeriesStart>();
const replay = replayRatings(history, LIVE_PARAMS, {
  collectPredictions: true,
  onBeforeGame: (game, state) => {
    if (game.kind !== "playoff") return;
    const key = seriesKey(game.season, game.homeId, game.awayId);
    if (seriesStarts.has(key)) return;
    seriesStarts.set(key, {
      season: game.season,
      round: game.round ?? "unknown",
      homeCourtId: game.homeId,
      otherId: game.awayId,
      neutral: game.neutral,
      probabilityHomeCourt: seriesProbability(game, state),
    });
  },
});

const kalman: ScoredGame[] = replay.predictions.map(({ game, prediction, homeWon }) => ({
  id: game.id,
  season: game.season,
  p: prediction.homeWinProbability,
  y: homeWon ? 1 : 0,
}));
const elo = eloPredictions(history, development.comparatorParams.elo);
const srs = srsToDatePredictions(history, development.comparatorParams.srs);
const homeRate = homeRatePredictions(history);

function evaluate(seasons: number[], label: string) {
  const candidate = isIn(kalman, seasons, "regular");
  const eloRows = isIn(elo, seasons, "regular");
  const srsRows = isIn(srs, seasons, "regular");
  const homeRows = isIn(homeRate, seasons, "regular");
  const fit = calibrationFit(candidate);
  const clean = (rows: ScoredGame[]) => {
    const summary = summarize(rows);
    return {
      n: summary.n,
      brier: round(summary.brier),
      logLoss: round(summary.logLoss),
      accuracy: round(summary.accuracy),
    };
  };
  const interval = (reference: ScoredGame[], name: string) => {
    const result = pairedSeasonBootstrap(candidate, reference, `${label}:${name}`);
    return {
      difference: round(result.difference),
      lower: round(result.lower),
      upper: round(result.upper),
      clusters: result.clusters,
    };
  };
  return {
    seasons,
    kalman: clean(candidate),
    elo: clean(eloRows),
    srs: clean(srsRows),
    homeRate: clean(homeRows),
    againstHomeRate: interval(homeRows, "home"),
    againstElo: interval(eloRows, "elo"),
    againstSrs: interval(srsRows, "srs"),
    calibrationSlope: round(fit.slope, 4),
    calibrationIntercept: round(fit.intercept, 4),
    reliability: round(reliability(candidate)),
  };
}

const gate = evaluate(GATE_SEASONS, "gate");
const separate = evaluate(SEPARATE_SEASONS, "separate");

const perSeason = [...GATE_SEASONS, ...SEPARATE_SEASONS].map((season) => {
  const rows = isIn(kalman, [season], "regular");
  const summary = summarize(rows);
  const early = rows.filter((row) => {
    const month = Number(kindById.get(row.id)?.etDate.slice(5, 7));
    return month === 10 || month === 11 || month === 12;
  });
  return {
    season,
    n: summary.n,
    brier: round(summary.brier),
    accuracy: round(summary.accuracy),
    earlyBrier: early.length ? round(summarize(early).brier) : null,
    eloBrier: round(summarize(isIn(elo, [season], "regular")).brier),
    srsBrier: round(summarize(isIn(srs, [season], "regular")).brier),
  };
});

function playoffGames(seasons: number[]) {
  const summary = summarize(isIn(kalman, seasons, "playoff"));
  return {
    n: summary.n,
    brier: round(summary.brier),
    logLoss: round(summary.logLoss),
    accuracy: round(summary.accuracy),
  };
}

// ---------------------------------------------------------------------------
// Series Brier against the repo's rolling SRS + home reference
// ---------------------------------------------------------------------------

const research = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "docs/backtest/research.json"), "utf-8"),
) as {
  results: Array<{
    id: string;
    rollingPredictions: {
      series: Array<{ id: string; season: number; p: number; y: number }>;
    };
  }>;
};
const reference = research.results.find((row) => row.id === "srs_home");
if (!reference) throw new Error("SRS + home reference is missing from research.json.");

const finalWins = new Map<string, Map<string, number>>();
for (const game of history) {
  if (game.kind !== "playoff" || game.status !== "final") continue;
  const key = seriesKey(game.season, game.homeId, game.awayId);
  const wins = finalWins.get(key) ?? new Map<string, number>();
  const winner =
    (game.homeScore as number) > (game.awayScore as number) ? game.homeId : game.awayId;
  wins.set(winner, (wins.get(winner) ?? 0) + 1);
  finalWins.set(key, wins);
}

const kalmanSeries: ScoredGame[] = [];
const referenceSeries: ScoredGame[] = [];
let unmatched = 0;
for (const row of reference.rollingPredictions.series) {
  // The reference covers older seasons and team codes outside this store.
  if (row.season < 2006) continue;
  const parts = row.id.split("-");
  const teamA = teamIdFromRepoCode(parts[parts.length - 2]);
  const teamB = teamIdFromRepoCode(parts[parts.length - 1]);
  const key = seriesKey(row.season, teamA, teamB);
  const start = seriesStarts.get(key);
  const wins = finalWins.get(key);
  if (!start || !wins) {
    unmatched += 1;
    continue;
  }
  const seriesId = `${row.season}-${key}`;
  const winnerId = [...wins.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const homeCourtWon = winnerId === start.homeCourtId ? 1 : 0;
  kalmanSeries.push({
    id: seriesId,
    season: row.season,
    p: start.probabilityHomeCourt,
    y: homeCourtWon as 0 | 1,
  });
  const homeCourtIsA = teamA === start.homeCourtId;
  referenceSeries.push({
    id: seriesId,
    season: row.season,
    p: homeCourtIsA ? row.p : 1 - row.p,
    y: homeCourtWon as 0 | 1,
  });
}

function seriesComparison(seasons: number[], label: string) {
  const allowed = new Set(seasons);
  const candidate = kalmanSeries.filter((row) => allowed.has(row.season));
  const base = referenceSeries.filter((row) => allowed.has(row.season));
  const interval = pairedSeasonBootstrap(candidate, base, `series:${label}`);
  return {
    n: candidate.length,
    kalmanBrier: round(summarize(candidate).brier),
    srsHomeBrier: round(summarize(base).brier),
    difference: round(interval.difference),
    lower: round(interval.lower),
    upper: round(interval.upper),
  };
}

// ---------------------------------------------------------------------------
// Gate verdicts
// ---------------------------------------------------------------------------

const verdicts = {
  G1: gate.againstHomeRate.upper < 0,
  G2: gate.againstElo.lower <= 0 && gate.againstSrs.lower <= 0,
  G3: {
    slopeInRange: gate.calibrationSlope >= 0.9 && gate.calibrationSlope <= 1.1,
    reliabilityUnderLimit: gate.reliability <= 0.002,
  },
};

const report = {
  modelVersion: LIVE_MODEL_VERSION,
  params: LIVE_PARAMS,
  gameLevel: {
    gateSeasons: gate,
    reportedSeparately: {
      label: "model form chosen with sight of these seasons",
      ...separate,
    },
    perSeason,
    verdicts,
  },
  playoffs: {
    games: {
      gateSeasons: playoffGames(GATE_SEASONS),
      reportedSeparately: playoffGames(SEPARATE_SEASONS),
    },
    seriesAgainstSrsHome: {
      gateSeasons: seriesComparison(GATE_SEASONS, "gate"),
      reportedSeparately: seriesComparison(SEPARATE_SEASONS, "separate"),
      unmatchedReferenceSeries: unmatched,
    },
  },
  finalHomeCourtState: round(replay.state.mean[30], 3),
};

const output = path.join(process.cwd(), "docs/live/evaluation-games.json");
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
console.log(JSON.stringify(report, null, 2));
