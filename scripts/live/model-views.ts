// The model views the job publishes for the site beside the ledger-derived files:
// projections with the injury term, team injury lists, and the player files. Built from
// what the run already computed (the published replay's tracker, current absences, the
// state's ratings and the reports in use) and the stored player lines, then checked
// against the same invariants `verify:live` runs. Never a model input, never a seal.

import { lostValue, type AvailabilityTracker, type CurrentAbsence, type ReportPoint } from "../../src/lib/season/injury-model";
import type { InjuryModel } from "../../src/lib/season/live-injury";
import type { LiveReportDay } from "../../src/lib/season/live-reports";
import {
  derivePlayerFiles,
  injuryListings,
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
  const players = derivePlayerFiles({
    season: input.season,
    seasonLabel: input.seasonLabel,
    days: input.playerDays,
    listings,
    impact: impactFrom(input.tracker, input.model),
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
  return { projections, teamInjuries, players, files: content };
}
