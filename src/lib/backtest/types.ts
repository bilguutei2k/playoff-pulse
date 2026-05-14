// Canonical type definitions for the backtesting and evaluation harness.
// Imported by both scripts/backtest/* and (eventually) src/components for UI display.

export type HistoricalRound =
  | "First Round"
  | "Conference Semifinal"
  | "Conference Final"
  | "NBA Finals";

export type HistoricalConference = "East" | "West" | "Finals";

// One series result — the ground truth used for evaluation.
// teamA is always the higher seed (lower seed number), or the home-court team for the Finals.
export type HistoricalSeries = {
  id: string;                    // e.g. "2024-west-cf-okc-min"
  season: number;                // year the playoffs concluded (BBRef convention)
  round: HistoricalRound;
  conference: HistoricalConference;
  teamA: string;                 // BBRef abbreviation, higher seed
  teamB: string;                 // lower seed
  seedA: number;
  seedB: number;
  winsA: number;                 // final wins for teamA
  winsB: number;
  winner: string;                // abbreviation of the series winner
  gamesPlayed: number;           // 4–7
  seriesStartDate: string;       // ISO "YYYY-MM-DD"
  seriesEndDate: string;
  homePattern: string[];         // abbreviation of home team for each game slot
  bubble: boolean;               // true for all 2020 series (Disney World bubble)
};

// One game within a historical series.
export type HistoricalGame = {
  seriesId: string;
  gameNumber: number;            // 1-indexed within the series
  date: string;                  // ISO "YYYY-MM-DD"
  homeTeam: string;              // BBRef abbreviation
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  winner: string;                // abbreviation of game winner
};

// One player entry in a historical team snapshot.
// impact and projectedMinutes are derived from bpm and mpg for model consumption.
export type HistoricalPlayerSnapshot = {
  name: string;
  bpm: number;                   // raw BPM from BBRef regular-season advanced stats
  mpg: number;                   // minutes per game (regular season only)
  gamesPlayed: number;
  impact: number;                // proxy: equal to bpm; see methodology for approximation gap
  projectedMinutes: number;      // min(mpg, 40) — capped at playoff-rotation ceiling
};

// Pre-series team strength snapshot — the historical equivalent of the live Team record.
// snapshot_as_of MUST be before the first game of any series this team played in that year.
// All players are treated as healthy (no historical injury data available; documented limitation).
export type TeamSeasonSnapshot = {
  teamId: string;                // BBRef abbreviation
  teamName: string;
  season: number;
  conference: "East" | "West";
  seed: number;
  snapshot_as_of: string;        // ISO "YYYY-MM-DD" — last day of regular season

  // Model inputs (parallel to the live Team type)
  eloRating: number;             // proxy: 1500 + (srs × 35); see eloSource
  netRating: number;             // ORTG − DRTG from BBRef team ratings page
  manualAdjustment: 0;           // always 0 for historical; literal type enforces it
  players: HistoricalPlayerSnapshot[];

  // Raw source values retained for transparency and cross-checking
  srs: number;                   // Simple Rating System from BBRef
  ortg: number;
  drtg: number;
  wins: number;
  losses: number;

  // Documentation literals — make the methodological gap visible in the type itself
  eloSource: "srs_proxy";
  playerImpactSource: "bpm_proxy";
};

// Which model generated a prediction.
export type ModelName =
  | "playoff_pulse"
  | "coinflip"
  | "home_team"
  | "higher_seed"
  | "elo_only"
  | "net_rating_only";

// One prediction from one model for one series.
// predictedProbabilityA is P(teamA wins the series).
// actualOutcome is 1 if teamA won, 0 if teamB won.
export type BacktestPrediction = {
  seriesId: string;
  season: number;
  round: HistoricalRound;
  conference: HistoricalConference;
  teamA: string;
  teamB: string;
  modelName: ModelName;
  predictedProbabilityA: number; // strictly in (0, 1)
  actualOutcome: number;         // 1 or 0
  bubble: boolean;
  snapshotAsOf: string;          // mirrors TeamSeasonSnapshot.snapshot_as_of for leakage checks
  seriesStartDate: string;
};

// One bucket in a calibration curve (10 equal-width buckets spanning [0, 1]).
export type CalibrationBucket = {
  bucketMin: number;             // inclusive lower bound
  bucketMax: number;             // exclusive upper bound (1.0 bucket is inclusive)
  predictedMean: number;         // average predicted probability among predictions in this bucket
  actualWinRate: number;         // fraction of predictions in this bucket where teamA actually won
  count: number;
};

// Reusable breakdown stats for sub-slices of the prediction set.
export type BreakdownStats = {
  brierScore: number;
  logLoss: number;
  n: number;
};

// Full evaluation result for one model across all historical series.
export type EvaluationResult = {
  modelName: ModelName;
  n: number;                     // total predictions
  brierScore: number;            // lower is better; mean of (p − outcome)²
  logLoss: number;               // lower is better; mean of −log(p) for correct outcome
  accuracy: number;              // fraction where the model's favored team actually won
  calibrationBuckets: CalibrationBucket[];
  breakdown: {
    bySeason: Record<number, BreakdownStats>;
    byRound: Partial<Record<HistoricalRound, BreakdownStats>>;
    bubble: BreakdownStats;
    nonBubble: BreakdownStats;
  };
};

// Top-level report structure written to docs/backtest/results.json.
export type BacktestReport = {
  generatedAt: string;           // ISO timestamp
  seasons: number[];
  totalSeries: number;
  models: ModelName[];
  results: EvaluationResult[];
  predictions: BacktestPrediction[];
};
