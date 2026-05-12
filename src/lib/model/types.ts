export type Conference = "East" | "West";

export type PlayoffRound =
  | "First Round"
  | "Conference Semifinal"
  | "Conference Final";

export type InjuryStatus = "healthy" | "questionable" | "limited" | "out";

export type Team = {
  id: string;
  name: string;
  abbreviation: string;
  conference: Conference;
  seed: number;
  eloRating: number;
  netRating: number;
  manualAdjustment: number;
  players: Player[];
};

export type Player = {
  id: string;
  name: string;
  teamId: string;
  impact: number;
  projectedMinutes: number;
  injuryStatus: InjuryStatus;
};

export type Series = {
  id: string;
  round: PlayoffRound;
  conference: Conference;
  bracketOrder: number;
  teamA: string;
  teamB: string;
  winsA: number;
  winsB: number;
  homePattern: string[];
};

export type ModelSettings = {
  playerWeight: number;
  netRatingWeight: number;
  eloWeight: number;
  homeCourtAdvantage: number;
  logisticScale: number;
  simulationIterations: number;
};

export type GameForecast = {
  gameNumber: number;
  homeTeamId: string;
  expectedMarginForTeamA: number;
  teamAWinProbability: number;
  teamBWinProbability: number;
};

export type SeriesForecast = {
  seriesId: string;
  teamAId: string;
  teamBId: string;
  winsA: number;
  winsB: number;
  nextGame: GameForecast | null;
  teamASeriesWinProbability: number;
  teamBSeriesWinProbability: number;
  expectedGamesRemaining: number;
  iterations: number;
  teamStrengthDifference: number;
};

export type SeriesSimulationOutcome = {
  winnerId: string;
  loserId: string;
  winsA: number;
  winsB: number;
  gamesPlayed: number;
};

export type BracketForecastRow = {
  teamId: string;
  conference: Conference;
  reachConferenceFinalsProbability: number;
  reachFinalsProbability: number;
  championshipProbability: number;
};

export type BracketForecast = {
  rows: BracketForecastRow[];
  iterations: number;
  titleProbabilityTotal: number;
  structurallyComplete: boolean;
  notes: string[];
};

export type BracketCoverageRound = {
  round: PlayoffRound;
  configuredSeries: number;
  expectedSeries: number;
  complete: boolean;
};

export type BracketCoverageConference = {
  conference: Conference;
  rounds: BracketCoverageRound[];
  complete: boolean;
};

export type BracketCoverage = {
  conferences: BracketCoverageConference[];
  complete: boolean;
  warnings: string[];
};

export type TeamForecast = {
  teamId: string;
  playerMinuteImpact: number;
  netRating: number;
  eloPointValue: number;
  manualAdjustment: number;
  finalStrength: number;
};

export type MarketOdds = {
  seriesId: string;
  teamId: string;
  source: string;
  moneyline?: number;
  impliedProbability?: number;
  capturedAt?: string;
  isPlaceholder: boolean;
};

export type PlayoffConfig = {
  teams: Team[];
  series: Series[];
  marketOdds: MarketOdds[];
  notes: string[];
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};
