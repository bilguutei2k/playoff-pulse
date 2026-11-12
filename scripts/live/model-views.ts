// The model views the job publishes for the site beside the ledger-derived files:
// projections with the injury term, team injury lists, and the player files. Built from
// what the run already computed (the published replay's tracker, current absences, the
// state's ratings and the reports in use) and the stored player lines, then checked
// against the same invariants `verify:live` runs. Never a model input, never a seal.
//
// The player index also carries the experimental 548 score: Stage 1's box value
// (src/lib/score/live.ts, from the stored player lines and the committed prior) plus
// Stage 2's on-court part (src/lib/score/live-on-court.ts, from the stored stints and the
// committed carried δ). A part that cannot be computed never stops the views: without the
// on-court part the index carries Stage 1 alone, without Stage 1 every score is null, and
// the reason is returned as `scoreProblem`. The score never reaches a forecast, a seal or
// the ledger.

import { lostValue, type AvailabilityTracker, type CurrentAbsence, type ReportPoint } from "../../src/lib/season/injury-model";
import { liveScoresFromDays, publishedScores, scoreProblems, type PriorPiece, type PublishedScore } from "../../src/lib/score/live";
import { liveOnCourt, onCourtProblems, publishedOnCourt } from "../../src/lib/score/live-on-court";
import type { StintDay } from "../../src/lib/score/live-stints";
import {
  SCORE_BOOK,
  SCORE_CHECKPOINT_DAYS,
  SCORE_COEFFICIENTS,
  SCORE_MODEL_VERSION,
  SCORE_MODEL_VERSION_S2,
  SCORE_ON_COURT,
  SCORE_ON_COURT_REPLACEMENT,
} from "../../src/lib/score/params";
import type { InjuryModel } from "../../src/lib/season/live-injury";
import type { LiveReportDay } from "../../src/lib/season/live-reports";
import {
  derivePlayerFiles,
  injuryListings,
  SCORE_LABEL,
  SCORE_LABEL_BOX,
  type PlayerGamesDay,
  type PlayerIndexFile,
  type ResolvedListing,
  type StoredPlayerGame,
  type TeamPlayersFile,
} from "../../src/lib/season/player-stats";
import {
  projectionProblems,
  projectUpcomingGames,
  teamInjuryLists,
  teamInjuryProblems,
  type ProjectionInput,
  type ProjectionsFile,
  type SlateReport,
  type TeamInjuriesFile,
} from "../../src/lib/season/projections";
import {
  siteFileContent,
  sitePlayerIndexPath,
  siteProjectionsPath,
  siteTeamInjuriesPath,
  siteTeamPlayersPath,
} from "../../src/lib/season/site-files";
import { SEASON_TEAMS } from "../../src/lib/season/teams";
import type { LedgerRow, LiveState, SeasonGame } from "../../src/lib/season/types";

/** A view the site fetches must stay well under the data cache's 2 MB item limit. */
export const VIEW_FILE_LIMIT_BYTES = 1_500_000;

export type ModelViews = {
  projections: ProjectionsFile;
  teamInjuries: TeamInjuriesFile;
  players: { index: PlayerIndexFile; teams: Map<string, TeamPlayersFile> };
  /** Path under data/live to exact content. */
  files: Map<string, string>;
  /** Why the index carries less than the full 548 score (Stage 2) this run; null when it carries it. */
  scoreProblem: string | null;
  score: ScoreRun;
};

export type ViewReport = {
  etDate: string;
  point: ReportPoint & { printed?: readonly string[] };
  stale: boolean;
  file: string | null;
};

/** Whether a player has a line in a stored game: true, false, or null if the game is not stored. */
export function playedInStore(days: readonly PlayerGamesDay[]): (gameId: string, teamId: string, athleteId: string) => boolean | null {
  const games = new Map<string, StoredPlayerGame>();
  for (const day of days) for (const [gameId, game] of Object.entries(day.games)) games.set(gameId, game);
  return (gameId, teamId, athleteId) => {
    const game = games.get(gameId);
    if (!game) return null;
    return (game.teams[teamId]?.lines ?? []).some((line) => line[0] === athleteId);
  };
}

/**
 * The published 548 scores from the stored days and the prior's pieces, or the reason
 * there are none: no prior, or a computation or invariant failure. Never throws.
 */
export function scoresFrom(
  season: number,
  days: readonly PlayerGamesDay[],
  prior: ReadonlyMap<string, readonly PriorPiece[]> | null,
  priorProblem: string | null = null,
): { scores: Map<string, PublishedScore> | null; problem: string | null } {
  if (!prior) return { scores: null, problem: priorProblem ?? "548 score prior not loaded" };
  try {
    const scores = publishedScores(
      liveScoresFromDays({ season, days, prior, coefficients: SCORE_COEFFICIENTS, params: SCORE_BOOK }),
    );
    const problems = scoreProblems(scores);
    if (problems.length > 0) return { scores: null, problem: `548 score failed its checks: ${problems.slice(0, 3).join("; ")}` };
    return { scores, problem: null };
  } catch (error) {
    return { scores: null, problem: `548 score not computed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** One published 548 score: the total, the box part's share from this season, and its two parts (on-court null under Stage 1). */
export type PublishedScoreParts = { score: number; share: number; box: number; onCourt: number | null };

export type ScoreRun = {
  scores: Map<string, PublishedScoreParts> | null;
  /** `SCORE_MODEL_VERSION_S2`, `SCORE_MODEL_VERSION` (box scores alone), or null (no score). */
  model: string | null;
  label: string;
  /**
   * The on-court part's checkpoint in use, when its solve used this season's stints; null
   * while δ is the carried value (before the first checkpoint, or none stored before it) or
   * without the on-court part.
   */
  checkpoint: string | null;
  /** Why the index carries less than Stage 2; null when it carries Stage 2. */
  problem: string | null;
  /** What the on-court solve used, for the log; null without it. */
  onCourt: { firstGame: string | null; checkpoint: string | null; rows: number; stintGames: number } | null;
};

/**
 * The published 548 scores with their parts: Stage 2 (box value + δ) when every input is
 * usable and the result passes its checks; else Stage 1 alone (`SCORE_MODEL_VERSION`, no
 * on-court part) with the reason; else no score with the reason. Never throws.
 */
export function scoresWithOnCourt(input: {
  season: number;
  /** The ET date the on-court part is for: the job's slate. */
  today: string;
  days: readonly PlayerGamesDay[];
  prior: ReadonlyMap<string, readonly PriorPiece[]> | null;
  priorProblem?: string | null;
  /** The stored stint days, or null when they could not be read (with `stintProblem`). */
  stintDays: readonly StintDay[] | null;
  stintProblem?: string | null;
  carried: ReadonlyMap<string, number> | null;
  carriedProblem?: string | null;
}): ScoreRun {
  const stage1 = scoresFrom(input.season, input.days, input.prior, input.priorProblem ?? null);
  if (!stage1.scores) return { scores: null, model: null, label: SCORE_LABEL, checkpoint: null, problem: stage1.problem, onCourt: null };
  const boxOnly = (problem: string): ScoreRun => ({
    scores: new Map([...stage1.scores!].map(([athleteId, value]) => [athleteId, { ...value, box: value.score, onCourt: null }])),
    model: SCORE_MODEL_VERSION,
    label: SCORE_LABEL_BOX,
    checkpoint: null,
    problem: `548 score published from box scores only: ${problem}`,
    onCourt: null,
  });
  if (!input.carried) return boxOnly(input.carriedProblem ?? "carried δ not loaded");
  if (!input.stintDays) return boxOnly(input.stintProblem ?? "stints not loaded");
  try {
    const result = liveOnCourt({
      season: input.season,
      today: input.today,
      days: input.days,
      stintDays: input.stintDays,
      prior: input.prior as ReadonlyMap<string, readonly PriorPiece[]>,
      carried: input.carried,
      coefficients: SCORE_COEFFICIENTS,
      book: SCORE_BOOK,
      params: SCORE_ON_COURT,
      checkpointDays: SCORE_CHECKPOINT_DAYS,
      replacement: SCORE_ON_COURT_REPLACEMENT,
    });
    const scores = publishedOnCourt(result);
    const problems = onCourtProblems(scores);
    // The box part is Stage 1 itself: the same players and the same values.
    if (scores.size !== stage1.scores.size) problems.push(`${scores.size} on-court scores for ${stage1.scores.size} box scores`);
    for (const [athleteId, value] of stage1.scores) {
      const parts = scores.get(athleteId);
      if (!parts || parts.box !== value.score || parts.share !== value.share) {
        problems.push(`the box part for ${athleteId} is not his Stage 1 score`);
        break;
      }
    }
    if (problems.length > 0) return boxOnly(`the on-court part failed its checks: ${problems.slice(0, 3).join("; ")}`);
    return {
      scores,
      model: SCORE_MODEL_VERSION_S2,
      label: SCORE_LABEL,
      // Only a checkpoint whose solve used this season's stints moved δ; before one, δ is the carried value.
      checkpoint: result.rows > 0 ? result.checkpoint : null,
      problem: null,
      onCourt: { firstGame: result.firstGame, checkpoint: result.checkpoint, rows: result.rows, stintGames: result.stintGames },
    };
  } catch (error) {
    return boxOnly(`the on-court part was not computed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 548 impact: beta times `lostValue` in the published replay's book, or null if the model has no record. */
export function impactFrom(tracker: AvailabilityTracker, model: InjuryModel): (athleteId: string) => number | null {
  return (athleteId) =>
    tracker.book.has(athleteId)
      ? Number((model.injury.beta * lostValue(tracker.book, athleteId, model.injury)).toFixed(3))
      : null;
}

export function buildModelViews(input: {
  season: number;
  seasonLabel: string;
  modelVersion: string;
  games: readonly SeasonGame[];
  slate: string;
  state: Pick<LiveState, "ratings" | "ratingsHash" | "ratingsThroughUtc" | "params">;
  model: InjuryModel;
  tracker: AvailabilityTracker;
  current: readonly CurrentAbsence[];
  /** The current slate's report in use for seals, when there is one. */
  slateReport: ViewReport | null;
  /** The next ET date's latest usable report at or before now, by the seal rules. */
  nextReport: ViewReport | null;
  reportDays: (etDate: string) => LiveReportDay | null;
  resolve: (teamId: string, printed: string) => string | null;
  nameOf: (athleteId: string) => string | undefined;
  playerDays: readonly PlayerGamesDay[];
  ledger: readonly LedgerRow[];
  /** The 548 score's prior pieces (scripts/live/score-prior.ts); null when unusable, with the reason. */
  scorePrior: ReadonlyMap<string, readonly PriorPiece[]> | null;
  scorePriorProblem: string | null;
  /** Stage 2's carried δ (scripts/live/score-prior.ts); null when unusable, with the reason. */
  scoreCarried: ReadonlyMap<string, number> | null;
  scoreCarriedProblem: string | null;
  /** The stored stint days (scripts/live/stint-collect.ts); null when unreadable, with the reason. */
  stintDays: readonly StintDay[] | null;
  stintProblem: string | null;
}): ModelViews {
  const reports: SlateReport[] = [input.slateReport, input.nextReport]
    .filter((report): report is ViewReport => report !== null)
    .map(({ etDate, point, stale }) => ({ etDate, point, stale }));
  const projectionInput: ProjectionInput = {
    season: input.season,
    seasonLabel: input.seasonLabel,
    modelVersion: input.modelVersion,
    games: input.games,
    fromEtDate: input.slate,
    ratings: input.state.ratings,
    ratingsHash: input.state.ratingsHash,
    ratingsThroughUtc: input.state.ratingsThroughUtc,
    params: input.state.params,
    model: input.model,
    tracker: input.tracker,
    current: input.current,
    reports,
    nameOf: input.nameOf,
  };
  const projections = projectUpcomingGames(projectionInput);
  const files = new Map([input.slateReport, input.nextReport].flatMap((report) => (report ? [[report.etDate, report.file]] : [])));
  const teamIds = SEASON_TEAMS.map((team) => team.id);
  const teamInjuries = teamInjuryLists({ ...projectionInput, teamIds, reportFile: (etDate) => files.get(etDate) ?? null });

  const listings: ResolvedListing[] = injuryListings({
    games: input.games,
    reportDay: input.reportDays,
    resolve: input.resolve,
    playedIn: playedInStore(input.playerDays),
  });
  const score = scoresWithOnCourt({
    season: input.season,
    today: input.slate,
    days: input.playerDays,
    prior: input.scorePrior,
    priorProblem: input.scorePriorProblem,
    stintDays: input.stintDays,
    stintProblem: input.stintProblem,
    carried: input.scoreCarried,
    carriedProblem: input.scoreCarriedProblem,
  });
  const players = derivePlayerFiles({
    season: input.season,
    seasonLabel: input.seasonLabel,
    days: input.playerDays,
    listings,
    impact: impactFrom(input.tracker, input.model),
    score: (athleteId) => score.scores?.get(athleteId) ?? null,
    scoreModel: score.model,
    scoreLabel: score.label,
    scoreCheckpoint: score.checkpoint,
    nameOf: input.nameOf,
  });

  const problems = [
    ...projectionProblems(projections, {
      ratings: input.state.ratings,
      params: input.state.params,
      games: input.games,
      ledger: input.ledger,
    }),
    ...teamInjuryProblems(teamInjuries, projections, teamIds),
  ];
  const content = new Map<string, string>();
  content.set(siteProjectionsPath(input.seasonLabel), siteFileContent(projections));
  content.set(siteTeamInjuriesPath(input.seasonLabel), siteFileContent(teamInjuries));
  content.set(sitePlayerIndexPath(input.seasonLabel), siteFileContent(players.index));
  for (const [teamId, file] of players.teams) content.set(siteTeamPlayersPath(input.seasonLabel, teamId), siteFileContent(file));
  for (const [relative, text] of content) {
    const bytes = Buffer.byteLength(text);
    if (bytes > VIEW_FILE_LIMIT_BYTES) problems.push(`${relative} is ${bytes} bytes, over ${VIEW_FILE_LIMIT_BYTES}`);
  }
  if (problems.length > 0) throw new Error(`model views failed validation: ${problems.slice(0, 5).join("; ")}`);
  return { projections, teamInjuries, players, files: content, scoreProblem: score.problem, score };
}
