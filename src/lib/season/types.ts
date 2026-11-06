// Shared types for the live season engine. Pure data only.

import type { AbsenceClass, StatusCode } from "@/lib/season/availability";
import type { InjuryParams, StatusTable, SurvivalTable } from "@/lib/season/injury-model";

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

/**
 * A v2 game gets a morning seal and, an hour before tip, a final seal. A morning seal made
 * with no injury report is reissued once a usable report arrives; the original row stays.
 * v1 rows carry no kind.
 */
export type SealKind = "morning" | "reissued" | "final";

/** A listed player behind a team's absence adjustment. */
export type AbsenceDriver = {
  athleteId: string;
  name: string;
  /**
   * Report status. Null for a player counted out because he missed the team's last game
   * and is not listed: in a provisional number, or on a seal's unfiled side. Always set
   * on a side the report covers.
   */
  status: StatusCode | null;
  /** Points of margin the team gives up for him, already weighted by status. */
  points: number;
};

export type SealRow = {
  type: "seal";
  gameId: string;
  etDate: string;
  tipUtc: string;
  issuedAt: string;
  /**
   * v2's policy revision in force at `issuedAt` (`src/lib/season/policy-revisions.ts`).
   * Stored on v2 seals from 2026-11-06; older rows derive it from `issuedAt` and are
   * never rewritten.
   */
  policyRevision?: number;
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
  // Fields below exist on v2 rows only. Absent means a v1 row, which is a morning seal.
  sealKind?: SealKind;
  /** Header timestamp of the NBA injury report used, ET wall clock; null when none was. */
  reportAt?: string | null;
  /** This run could not read a fresh report and used the last good one, under 24 hours old. */
  availabilityStale?: boolean;
  /** No usable report under 24 hours old: every absence is zero. */
  availabilityMissing?: boolean;
  /** Expected Game Score lost by each side, weighted by status. */
  absence?: { home: number; away: number };
  /** The same in points of margin: `beta` times `absence`. */
  absencePoints?: { home: number; away: number };
  /**
   * Players behind each side's absence term, largest first. Every one with positive
   * points when `driversComplete` is set; at most three on rows written before it.
   */
  drivers?: { home: AbsenceDriver[]; away: AbsenceDriver[] };
  /**
   * Set on rows written under the 2026-11-03 amendment to `docs/live/registration.md`:
   * `drivers` lists everyone behind each side's term, and each side's drivers add up to
   * its `absencePoints` (to rounding).
   */
  driversComplete?: boolean;
  /**
   * Sides whose team the report in use marked NOT YET SUBMITTED. Such a side's term is the
   * team's expected absence for this game from current absences, as the season simulation
   * charges it. Absent on rows written before that amendment, when such a side counted nobody.
   */
  unfiled?: { home: boolean; away: boolean };
  /** The reference model's number for the same game, recomputed at the same instant. */
  referenceModelVersion?: string;
  referenceHomeWinProbability?: number;
};

export type MissedRow = {
  type: "missed";
  gameId: string;
  etDate: string;
  tipUtc: string;
  homeId: string;
  awayId: string;
  recordedAt: string;
  /** Absent on rows written before v2, which all belong to v1. */
  modelVersion?: string;
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
  /** Games with at least one seal from this version. */
  sealed: number;
  scored: number;
  pending: number;
  missed: number;
  incomplete: number;
  /**
   * Scored games that had a morning seal but no final seal, so the reissued seal (when
   * there is one) or the original morning seal was scored. Null for a version that seals
   * once per game.
   */
  noFinalSeal: number | null;
  brier: number | null;
  logLoss: number | null;
  accuracy: number | null;
  /** Same scored games, always predicting the prior home-win rate. */
  baselineBrier: number | null;
  /**
   * The latest pre-final seal (reissued when there is one, else the original morning
   * seal), on scored games of a version that seals twice. Kept under this older name so
   * published states keep their meaning; `latestPreFinalBrier` is the same number.
   */
  morningBrier: number | null;
  // The pre-final scores, split (2026-11-06). Present on states written since then, for a
  // version that seals twice; absent on older states and for a version that seals once.
  // The operational score stays final, else reissued, else original morning.
  /** Original morning seals only (`sealKind: "morning"`), on scored games that have one. */
  originalMorningBrier?: number | null;
  originalMorningCount?: number;
  /** Reissued seals, on the scored games that were reissued. */
  reissuedBrier?: number | null;
  reissuedCount?: number;
  /** The reissued seal when there is one, else the original morning seal. */
  latestPreFinalBrier?: number | null;
  latestPreFinalCount?: number;
  /**
   * v2 only: the record split by policy revision, each game under the revision of the
   * seal it is scored on (pending games under the seal they would be scored on now).
   * Descriptive, not a comparison: revisions cover different games and dates.
   */
  policyRevisions?: PolicyRevisionRecord[];
  /**
   * The reference model's number stored on each scored seal, scored on the same games:
   * the prospective head-to-head. Null for a version whose rows carry no reference.
   */
  referenceBrier: number | null;
  referenceModelVersion: string | null;
  smallSample: boolean;
};

export type PolicyRevisionRecord = {
  revision: number;
  /** This version's seal rows of any kind (morning, reissued, final) issued under it. */
  sealRows: number;
  /** Games whose scored (or, while pending, current) seal was issued under this revision. */
  sealed: number;
  scored: number;
  brier: number | null;
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

/** A player the model currently counts as out, for display and the season simulation. */
export type PublishedAbsence = {
  teamId: string;
  athleteId: string;
  name: string;
  /** Status on the latest report that lists him, or null if he is out without being listed. */
  status: StatusCode | null;
  reason: string | null;
  class: AbsenceClass;
  /** Team games missed in a row so far. */
  gamesMissed: number;
  /** Further team games he is expected to miss, from the survival table. */
  expectedGames: number;
  /** Points of margin the team gives up while he is out. */
  points: number;
};

/** The artifact the pipeline publishes and the site bundles. */
export type LiveState = {
  schemaVersion: 2;
  season: number;
  seasonLabel: string;
  modelVersion: string;
  /** The model still sealing beside it, whose record continues. */
  referenceModelVersion: string;
  paramsHash: string;
  /** The authoritative timestamp for the live path. */
  generatedAt: string;
  /** ET slate on which the full schedule was last refreshed. */
  scheduleRefreshedEtDate: string;
  /** Latest final game included in ratings. */
  ratingsThroughUtc: string | null;
  ratingsHash: string;
  /** Team IDs in state order; `ratings` follows this order then home court. */
  teamOrder: string[];
  /** Full-strength ratings: margins are adjusted for who actually missed each game. */
  ratings: RatingState;
  /** Each team's scheduled ET dates around the slate, for back-to-back checks. */
  teamGameDates: Record<string, string[]>;
  /** The model parameters needed to price a game at request time. */
  params: ModelParams;
  /**
   * The frozen injury model, published so the site and the verifier can check it. Null
   * only when reading a state published before v2, which had no injury model.
   */
  injury: { params: InjuryParams; statusTable: StatusTable; survival: SurvivalTable } | null;
  /** The NBA injury report behind the current absences. */
  availability: { reportAt: string | null; stale: boolean; missing: boolean };
  /** Players currently counted as out, every team. */
  absences: PublishedAbsence[];
  /** Points each team gives up in its next game to current absences. */
  absencePoints: Record<string, number>;
  /** Full-strength rating minus current absence points. Display only. */
  currentRatings: Record<string, number>;
  /** Slate context: today and neighbouring dates. */
  slateEtDate: string;
  nextSlateEtDate: string | null;
  /** When the first forecast was sealed. Earlier games predate the record. */
  ledgerStartedAt: string | null;
  /** Every seal row for the recent window, in ledger order, keyed by game ID. */
  seals: Record<string, SealRow[]>;
  forecast: SeasonForecast;
  /** The record of `modelVersion`. */
  record: RecordSummary;
  /** Every version's record, keyed by version. */
  records: Record<string, RecordSummary>;
  history: TeamHistoryPoint[];
  notes: HealthNote[];
};

/** A scoreboard game with live detail, as the adapter normalizes it. */
export type ScoreboardRow = {
  game: SeasonGame;
  live: LiveStatus | null;
  statusDetail: string;
  market: MarketReference | null;
  /** Points by completed period, when ESPN provides linescores. */
  homeLinescores: number[];
  awayLinescores: number[];
  seriesSummary: string | null;
};

export type InjuryRow = {
  teamId: string;
  athleteId: string;
  name: string;
  status: string;
  date: string;
  /** ESPN's estimated return date. Stored for later study, never a model input. */
  returnDate?: string | null;
  /** ESPN's fantasy status, such as OUT, GTD or OFS. Stored, never a model input. */
  fantasyStatus?: string | null;
};
