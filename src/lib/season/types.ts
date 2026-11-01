// Shared types for the live season engine. Pure data only.

export type Conference = "East" | "West";

export type Division =
  | "Atlantic"
  | "Central"
  | "Southeast"
  | "Northwest"
  | "Pacific"
  | "Southwest";

export type SeasonTeam = {
  /** Stable ESPN numeric team ID. The engine keys on this, never abbreviations. */
  id: string;
  abbreviation: string;
  name: string;
  shortName: string;
  conference: Conference;
  division: Division;
};

export type GameKind = "regular" | "cup-final" | "play-in" | "playoff";

export type GameStatus =
  | "scheduled"
  | "in-progress"
  | "final"
  | "postponed"
  | "canceled";

export type PlayoffRound =
  | "first-round"
  | "conference-semifinal"
  | "conference-final"
  | "finals";

export type PlayInStage = "7v8" | "9v10" | "8-seed";

export type SeasonGame = {
  id: string;
  /** NBA season by ending year: 2027 means 2026-27. */
  season: number;
  kind: GameKind;
  tipUtc: string;
  /** Calendar date in America/New_York. Slates are always defined by this. */
  etDate: string;
  homeId: string;
  awayId: string;
  neutral: boolean;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  round?: PlayoffRound;
  playIn?: PlayInStage;
  conference?: Conference;
};

export type LiveStatus = {
  period: number;
  clockSeconds: number;
  display: string;
};

/** Model parameters. Frozen per version in `params.ts`. */
export type ModelParams = {
  /** Game-margin noise SD (points). */
  sigma: number;
  /** Daily variance added to each team's rating. */
  q: number;
  /** Daily variance added to the home-court state. */
  qHca: number;
  /** Rating carryover between seasons. */
  rho: number;
  /** Long-run SD of team strength. */
  tau: number;
  /** Starting home-court advantage (points). */
  hca0: number;
  /** Starting home-court variance. */
  hcaVar0: number;
  /** Margin adjustment against a team on a back-to-back (points). */
  b2b: number;
  /** Observed margins are clipped to +/- this before updating ratings. */
  marginCap: number;
  /** Added to the home-court state in playoff games (points). */
  hcaPlayoffDelta: number;
  /** Multiplier on the rating difference in playoff games. */
  playoffSpread: number;
};

export type RatingState = {
  /** 30 team ratings followed by the home-court state. */
  mean: number[];
  /** Full 31x31 covariance, row-major. */
  cov: number[];
};

export type GameContext = {
  homeId: string;
  awayId: string;
  neutral: boolean;
  playoff: boolean;
  homeOnBackToBack: boolean;
  awayOnBackToBack: boolean;
};

export type GamePrediction = {
  /** Expected home margin. */
  expectedMargin: number;
  /** Variance of the expected margin from rating uncertainty. */
  ratingVariance: number;
  homeWinProbability: number;
};

export type TeamForecast = {
  teamId: string;
  wins: number;
  losses: number;
  rating: number;
  ratingSd: number;
  projectedWins: number;
  projectedWinsP10: number;
  projectedWinsP90: number;
  /** Seed probabilities, index 0 is seed 1. */
  seedProbabilities: number[];
  topSix: number;
  playIn: number;
  makePlayoffs: number;
  reachSemifinals: number;
  reachConferenceFinals: number;
  reachFinals: number;
  champion: number;
};

export type SeriesForecast = {
  id: string;
  round: PlayoffRound;
  conference: Conference | "Finals";
  homeCourtId: string;
  otherId: string;
  homeCourtWins: number;
  otherWins: number;
  homeCourtSeriesProbability: number;
};

export type SeasonPhase =
  | "regular-season"
  | "play-in"
  | "playoffs"
  | "complete";

export type SeasonForecast = {
  season: number;
  phase: SeasonPhase;
  iterations: number;
  teams: TeamForecast[];
  series: SeriesForecast[];
  sums: {
    champion: number;
    makePlayoffs: number;
    topSix: number;
    playIn: number;
  };
};

export type MarketReference = {
  provider: string;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  homeSpread: number | null;
};

export type SealRow = {
  type: "seal";
  gameId: string;
  etDate: string;
  tipUtc: string;
  issuedAt: string;
  modelVersion: string;
  paramsHash: string;
  ratingsHash: string;
  homeId: string;
  awayId: string;
  homeWinProbability: number;
  expectedMargin: number;
  inputsIncomplete: boolean;
  missingGameIds: string[];
  runId: string;
  market: MarketReference | null;
};

export type MissedRow = {
  type: "missed";
  gameId: string;
  etDate: string;
  tipUtc: string;
  homeId: string;
  awayId: string;
  recordedAt: string;
};

export type ResultRow = {
  type: "result";
  gameId: string;
  homeScore: number;
  awayScore: number;
  recordedAt: string;
};

export type LedgerRow = SealRow | MissedRow | ResultRow;

export type RecordSummary = {
  modelVersion: string | null;
  sealed: number;
  scored: number;
  pending: number;
  missed: number;
  incomplete: number;
  brier: number | null;
  logLoss: number | null;
  accuracy: number | null;
  /** Same scored games, always predicting the prior home-win rate. */
  baselineBrier: number | null;
  smallSample: boolean;
};

export type TeamHistoryPoint = {
  date: string;
  /** Title probabilities keyed by team ID. */
  champion: Record<string, number>;
};

export type HealthNote = {
  level: "info" | "warning";
  message: string;
};

/** The artifact the pipeline publishes and the site bundles. */
export type LiveState = {
  schemaVersion: 1;
  season: number;
  seasonLabel: string;
  modelVersion: string;
  paramsHash: string;
  /** The authoritative timestamp for the live path. */
  generatedAt: string;
  /** Latest final game included in ratings. */
  ratingsThroughUtc: string | null;
  ratingsHash: string;
  /** Team IDs in state order; `ratings` follows this order then home court. */
  teamOrder: string[];
  ratings: RatingState;
  /** Each team's scheduled ET dates around the slate, for back-to-back checks. */
  teamGameDates: Record<string, string[]>;
  /** The model parameters needed to price a game at request time. */
  params: ModelParams;
  /** Slate context: today and neighbouring dates. */
  slateEtDate: string;
  nextSlateEtDate: string | null;
  /** Seals for the recent window, keyed by game ID. */
  seals: Record<string, SealRow>;
  forecast: SeasonForecast;
  record: RecordSummary;
  history: TeamHistoryPoint[];
  notes: HealthNote[];
};

export type InjuryRow = {
  teamId: string;
  athleteId: string;
  name: string;
  status: string;
  date: string;
};
