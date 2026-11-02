// The registered test of the injury model, on 2024-25 and 2025-26. Run once, after the
// registration commit. Nothing is refit after this has run. Writes
// docs/live/evaluation-injury.json and exits non-zero if the model does not pass.
//
// Run: corepack pnpm exec tsx scripts/live/evaluate-injury.ts

import * as fs from "node:fs";
import * as path from "node:path";
import { etWallClockOf } from "../../src/lib/season/dates";
import { normalCdf } from "../../src/lib/season/math";
import {
  currentAbsences,
  replayInjuryModel,
  simulationAbsences,
  type ForecastRow,
  type InjuryParams,
  type StatusTable,
  type SurvivalTable,
} from "../../src/lib/season/injury-model";
import { LIVE_PARAMS, SIMULATOR_UNCERTAINTY_SCALE } from "../../src/lib/season/params";
import { replayRatings, type FilterState } from "../../src/lib/season/ratings";
import {
  assertForecastSums,
  simulateSeason,
  type SimulationAbsences,
} from "../../src/lib/season/simulate";
import { buildStandings } from "../../src/lib/season/standings";
import { SEASON_TEAMS } from "../../src/lib/season/teams";
import type { SeasonGame } from "../../src/lib/season/types";
import { loadAvailabilityData } from "./availability-store";
import {
  accuracy,
  brier,
  calibrationFit,
  logLoss,
  pairedDateBootstrap,
  round,
  type ScoredGame,
} from "./eval-metrics";
import { compareGames, loadHistory, loadSeasonGames } from "./game-store";

const WARMUP_SEASON = 2021;
const FIT_SEASONS = [2022, 2023, 2024];
const TEST_SEASONS = [2025, 2026];
const FINAL_WINDOW_MS = 3 * 3_600_000;
const LARGE_GAP_POINTS = 2;
const ITERATIONS = 4000;
const CHECKPOINTS = ["dec1", "feb1", "apr1"] as const;
const SLOPE_TOLERANCE = 0.02;
const BRIER_TOLERANCE = 0.005;
const RMSE_TOLERANCE = 0.25;
const MARKET_SIGMA_GRID = [10, 11, 12, 13, 14];

type Fit = {
  fitted: InjuryParams;
  statusTable: Record<string, { absent: number }>;
  survival: { long: number[]; short: number[]; classUsed: boolean };
};

const fit = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "docs/live/injury-fit.json"), "utf-8"),
) as Fit;
const injury = fit.fitted;
const statusTable = Object.fromEntries(
  Object.entries(fit.statusTable).map(([code, row]) => [code, row.absent]),
) as StatusTable;
const survival: SurvivalTable = fit.survival;
const plain: InjuryParams = { ...injury, beta: 0 };

const lastSeason = TEST_SEASONS[TEST_SEASONS.length - 1];
const allGames = loadHistory(lastSeason).sort(compareGames);
const baseGames = allGames.filter((game) => game.season < WARMUP_SEASON);
const games = allGames.filter((game) => game.season >= WARMUP_SEASON);
const base = replayRatings(baseGames, LIVE_PARAMS).state;
const data = loadAvailabilityData(
  [WARMUP_SEASON, ...FIT_SEASONS, ...TEST_SEASONS],
  [...FIT_SEASONS, ...TEST_SEASONS],
);
const testSet = new Set(TEST_SEASONS);

const copyState = (state: FilterState): FilterState => ({
  mean: Float64Array.from(state.mean),
  cov: Float64Array.from(state.cov),
});

function qualifying(game: SeasonGame): boolean {
  if (game.kind !== "regular") return false;
  const final = data.availability(game.id)?.final;
  if (!final || final.notSubmitted.length > 0) return false;
  const tip = Date.parse(`${etWallClockOf(game.tipUtc)}:00Z`);
  return tip - Date.parse(`${final.at}:00Z`) <= FINAL_WINDOW_MS;
}

function forecasts(params: InjuryParams, seasons: Set<number>): ForecastRow[] {
  const rows: ForecastRow[] = [];
  replayInjuryModel({
    games,
    state: copyState(base),
    stateSeason: WARMUP_SEASON - 1,
    params: LIVE_PARAMS,
    injury: params,
    statusTable,
    boxScores: data.boxScores,
    availability: data.availability,
    onForecast: (row) => {
      if (seasons.has(row.game.season) && qualifying(row.game)) rows.push(row);
    },
  });
  return rows;
}

const outcome = (game: SeasonGame): 0 | 1 =>
  (game.homeScore as number) > (game.awayScore as number) ? 1 : 0;

function scored(rows: readonly ForecastRow[], pick: "final" | "morning"): ScoredGame[] {
  return rows.map((row) => ({
    id: row.game.id,
    season: row.game.season,
    p: row[pick].homeWinProbability,
    y: outcome(row.game),
  }));
}

const injuryRows = forecasts(injury, testSet);
const plainRows = forecasts(plain, testSet);
const candidate = scored(injuryRows, "final");
const reference = scored(plainRows, "final");
const dateById = new Map(injuryRows.map((row) => [row.game.id, row.game.etDate]));

const paired = pairedDateBootstrap(
  candidate,
  reference,
  (id) => dateById.get(id) as string,
  "live-injury-test-v2",
);
const perSeason = TEST_SEASONS.map((season) => {
  const c = candidate.filter((row) => row.season === season);
  const r = reference.filter((row) => row.season === season);
  return {
    season,
    games: c.length,
    injury: { brier: round(brier(c)), logLoss: round(logLoss(c)), accuracy: round(accuracy(c), 4) },
    plain: { brier: round(brier(r)), logLoss: round(logLoss(r)), accuracy: round(accuracy(r), 4) },
    difference: round(brier(c) - brier(r)),
  };
});
const slopes = {
  injury: calibrationFit(candidate).slope,
  plain: calibrationFit(reference).slope,
};

const t1 = paired.upper < 0 && perSeason.every((row) => row.difference < 0);
const t2 = logLoss(candidate) <= logLoss(reference);
const t3 = slopes.injury >= slopes.plain - SLOPE_TOLERANCE;

// ---------------------------------------------------------------------------
// T4: the simulator, as a bug check
// ---------------------------------------------------------------------------

function checkpointDate(season: number, checkpoint: (typeof CHECKPOINTS)[number]): string {
  if (checkpoint === "dec1") return `${season - 1}-12-01`;
  if (checkpoint === "feb1") return `${season}-02-01`;
  return `${season}-04-01`;
}

function seasonOutcome(season: number) {
  const seasonGames = loadSeasonGames(season);
  const made = new Set<string>();
  for (const game of seasonGames) {
    if (game.kind === "playoff" && game.status === "final") {
      made.add(game.homeId);
      made.add(game.awayId);
    }
  }
  return { seasonGames, made, finalWins: buildStandings(seasonGames).wins };
}

function asOfDate(seasonGames: readonly SeasonGame[], etDate: string): SeasonGame[] {
  return seasonGames
    .filter((game) => game.kind === "regular" || game.kind === "cup-final")
    .map((game) =>
      game.status === "final" && game.etDate >= etDate
        ? { ...game, status: "scheduled" as const, homeScore: null, awayScore: null }
        : game,
    );
}

function simulateAt(
  season: number,
  etDate: string,
  params: InjuryParams,
  withAbsences: boolean,
): { pMake: Map<string, number>; projected: Map<string, number> } {
  const { seasonGames } = seasonOutcome(season);
  const known = asOfDate(seasonGames, etDate);
  const replay = replayInjuryModel({
    games,
    state: copyState(base),
    stateSeason: WARMUP_SEASON - 1,
    params: LIVE_PARAMS,
    injury: params,
    statusTable,
    boxScores: data.boxScores,
    availability: data.availability,
    throughEtDate: etDate,
  });
  let absences: SimulationAbsences | undefined;
  if (withAbsences) {
    const pending: Record<string, number> = {};
    for (const game of known) {
      if (game.kind !== "regular" || game.status !== "scheduled") continue;
      pending[game.homeId] = (pending[game.homeId] ?? 0) + 1;
      pending[game.awayId] = (pending[game.awayId] ?? 0) + 1;
    }
    absences = simulationAbsences(currentAbsences(replay.tracker, params, survival), pending);
  }
  const forecast = simulateSeason({
    season,
    phase: "regular-season",
    games: known,
    state: replay.state,
    params: LIVE_PARAMS,
    asOfEtDate: etDate,
    lastGameEtDate: replay.lastGameEtDate,
    iterations: ITERATIONS,
    uncertaintyScale: SIMULATOR_UNCERTAINTY_SCALE,
    absences,
  });
  assertForecastSums(forecast);
  return {
    pMake: new Map(forecast.teams.map((team) => [team.teamId, team.makePlayoffs])),
    projected: new Map(forecast.teams.map((team) => [team.teamId, team.projectedWins])),
  };
}

const seasonChecks = CHECKPOINTS.map((checkpoint) => {
  let injuryBrier = 0;
  let plainBrier = 0;
  let injurySquared = 0;
  let plainSquared = 0;
  let count = 0;
  for (const season of TEST_SEASONS) {
    const { made, finalWins } = seasonOutcome(season);
    const date = checkpointDate(season, checkpoint);
    const withInjury = simulateAt(season, date, injury, true);
    const without = simulateAt(season, date, plain, false);
    SEASON_TEAMS.forEach((team, index) => {
      const y = made.has(team.id) ? 1 : 0;
      injuryBrier += ((withInjury.pMake.get(team.id) as number) - y) ** 2;
      plainBrier += ((without.pMake.get(team.id) as number) - y) ** 2;
      injurySquared += ((withInjury.projected.get(team.id) as number) - finalWins[index]) ** 2;
      plainSquared += ((without.projected.get(team.id) as number) - finalWins[index]) ** 2;
      count += 1;
    });
  }
  return {
    checkpoint,
    makePlayoffsBrier: { injury: round(injuryBrier / count), plain: round(plainBrier / count) },
    winRmse: {
      injury: round(Math.sqrt(injurySquared / count), 3),
      plain: round(Math.sqrt(plainSquared / count), 3),
    },
    teamSeasons: count,
  };
});
const t4 = seasonChecks.every(
  (row) =>
    row.makePlayoffsBrier.injury <= row.makePlayoffsBrier.plain + BRIER_TOLERANCE &&
    row.winRmse.injury <= row.winRmse.plain + RMSE_TOLERANCE,
);

// ---------------------------------------------------------------------------
// Reported only
// ---------------------------------------------------------------------------

const largeGapIds = new Set(
  injuryRows
    .filter(
      (row) => Math.abs(injury.beta * (row.finalAbsence.home - row.finalAbsence.away)) >= LARGE_GAP_POINTS,
    )
    .map((row) => row.game.id),
);
const onIds = (rows: readonly ScoredGame[], ids: ReadonlySet<string>) =>
  rows.filter((row) => ids.has(row.id));

const morningInjury = scored(injuryRows, "morning");

function loadSpreads(season: number): Record<string, number | null> {
  const file = path.join(process.cwd(), "data/season/spreads", `${season}.json`);
  return fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, number | null>)
    : {};
}
// The spread-to-probability scale comes from the fit seasons only.
const fitSpreads = Object.assign({}, ...FIT_SEASONS.map(loadSpreads)) as Record<string, number | null>;
const fitOutcomes = games.filter(
  (game) => FIT_SEASONS.includes(game.season) && game.kind === "regular" && fitSpreads[game.id] != null,
);
const marketProbability = (spread: number, sigma: number) => normalCdf(-spread / sigma);
let marketSigma = MARKET_SIGMA_GRID[0];
let marketBest = Number.POSITIVE_INFINITY;
for (const sigma of MARKET_SIGMA_GRID) {
  const value = logLoss(
    fitOutcomes.map((game) => ({
      id: game.id,
      season: game.season,
      p: marketProbability(fitSpreads[game.id] as number, sigma),
      y: outcome(game),
    })),
  );
  if (value < marketBest) {
    marketBest = value;
    marketSigma = sigma;
  }
}
const testSpreads = Object.assign({}, ...TEST_SEASONS.map(loadSpreads)) as Record<string, number | null>;
const marketRows: ScoredGame[] = injuryRows
  .filter((row) => testSpreads[row.game.id] != null)
  .map((row) => ({
    id: row.game.id,
    season: row.game.season,
    p: marketProbability(testSpreads[row.game.id] as number, marketSigma),
    y: outcome(row.game),
  }));
const marketIds = new Set(marketRows.map((row) => row.id));

const passed = t1 && t2 && t3 && t4;
const output = {
  note: "Registered test of the injury model. Run once. 2024-25 and 2025-26 regular seasons, final point, v2 against v1 on identical games. T1 is conservative: 2025-26 was seen when v1's form was chosen.",
  fitted: injury,
  games: candidate.length,
  gates: {
    T1: {
      passed: t1,
      difference: round(paired.difference),
      lower: round(paired.lower),
      upper: round(paired.upper),
      clusters: paired.clusters,
      draws: paired.draws,
      negativeInEachSeason: perSeason.every((row) => row.difference < 0),
    },
    T2: { passed: t2, injury: round(logLoss(candidate)), plain: round(logLoss(reference)) },
    T3: {
      passed: t3,
      injury: round(slopes.injury, 3),
      plain: round(slopes.plain, 3),
      tolerance: SLOPE_TOLERANCE,
    },
    T4: { passed: t4, checks: seasonChecks, brierTolerance: BRIER_TOLERANCE, rmseTolerance: RMSE_TOLERANCE },
  },
  passed,
  reportedOnly: {
    overall: {
      injury: { brier: round(brier(candidate)), accuracy: round(accuracy(candidate), 4) },
      plain: { brier: round(brier(reference)), accuracy: round(accuracy(reference), 4) },
    },
    perSeason,
    morningPoint: { injuryBrier: round(brier(morningInjury)) },
    largeGap: {
      thresholdPoints: LARGE_GAP_POINTS,
      games: largeGapIds.size,
      injuryBrier: round(brier(onIds(candidate, largeGapIds))),
      plainBrier: round(brier(onIds(reference, largeGapIds))),
    },
    market: {
      note: "ESPN's stored spread, timing unknown, turned into a probability with a scale chosen on fit seasons. Comparison only.",
      games: marketRows.length,
      scale: marketSigma,
      marketBrier: marketRows.length ? round(brier(marketRows)) : null,
      injuryBrier: marketRows.length ? round(brier(onIds(candidate, marketIds))) : null,
      plainBrier: marketRows.length ? round(brier(onIds(reference, marketIds))) : null,
    },
    coverage: {
      testGames: games.filter((game) => testSet.has(game.season) && game.kind === "regular").length,
      qualifying: candidate.length,
    },
  },
};
fs.writeFileSync(
  path.join(process.cwd(), "docs/live/evaluation-injury.json"),
  `${JSON.stringify(output, null, 2)}\n`,
  "utf-8",
);
console.log(JSON.stringify({ gates: output.gates, passed, reportedOnly: output.reportedOnly }, null, 1));
if (!passed) {
  console.error("[injury test] did not pass.");
  process.exit(2);
}
