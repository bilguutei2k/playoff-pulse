// The live forecast job: fetch, validate, seal, simulate, publish. Any failure
// exits non-zero before anything is written, so the last good state stays up.
//
// The published model is v2 (injury-adjusted). v1 keeps sealing its own morning rows,
// unchanged, so its record continues on the same games. Box scores and the NBA injury
// report are fetched and validated before anything is sealed.
//
// Run: corepack pnpm live:pipeline
// LIVE_NOW overrides the clock. LIVE_DRY_RUN=1 writes state and data but seals nothing;
// it prices and logs the seals a real run would write.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  createFetchJson,
  fetchInjuries,
  fetchScoreboardRows,
  fetchStandings,
  fetchTeamSchedule,
  parseEvents,
  type ScoreboardRow,
} from "../../src/lib/live-data/espn-season";
import { addDays, etWallClockOf } from "../../src/lib/season/dates";
import { seasonFormat, seasonLabel } from "../../src/lib/season/formats";
import {
  applyLatestReport,
  forgetEarlierSeasonReports,
  injuryModelHash,
  publishAbsences,
  replayFullStrength,
  seasonAvailability,
  sealInjuryGames,
  type InjuryModel,
  type InjurySealDecision,
} from "../../src/lib/season/live-injury";
import {
  chooseReport,
  reportProblem,
  latestReport,
  toReportPoint,
  type ChosenReport,
  type LiveReportDay,
} from "../../src/lib/season/live-reports";
import {
  crossCheckStandings,
  decideMissed,
  decideResults,
  decideReissues,
  decideSeals,
  sealedGameIds,
  sealGames,
  sealsByGame,
  shouldPublishState,
  slateDateAt,
  stuckGames,
  summarizeRecord,
  teamGameDatesAround,
  withoutLiveScores,
} from "../../src/lib/season/live-state";
import {
  buildObservedPostseason,
  crossCheckSeeds,
  detectPhase,
} from "../../src/lib/season/postseason";
import {
  INJURY_PARAMS,
  INJURY_STATUS_TABLE,
  INJURY_SURVIVAL,
  LIVE_MODEL_VERSION,
  LIVE_PARAMS,
  LIVE_SIMULATION_ITERATIONS,
  REFERENCE_MODEL_VERSION,
  SIMULATOR_UNCERTAINTY_SCALE,
} from "../../src/lib/season/params";
import { ratingsHash, toRatingState } from "../../src/lib/season/ratings";
import { simulateSeason } from "../../src/lib/season/simulate";
import { isModelViewPath } from "../../src/lib/season/site-files";
import type { PlayerGamesDay } from "../../src/lib/season/player-stats";
import { SEASON_TEAMS, teamById } from "../../src/lib/season/teams";
import type {
  HealthNote,
  InjuryRow,
  LedgerRow,
  LiveState,
  MarketReference,
  SealRow,
  SeasonForecast,
  SeasonGame,
  TeamHistoryPoint,
} from "../../src/lib/season/types";
import { compareGames, gamesPath, LIVE_DIRECTORY, LIVE_SEASON, loadHistory } from "./game-store";
import {
  PLAYER_GAMES_BUDGET_MS,
  PLAYER_GAMES_PER_RUN,
  collectBoxScores,
  collectPlayerGames,
  liveBoxScorePath,
  loadLiveAvailability,
  loadLiveBoxScores,
  loadPlayerDays,
  loadReportDay,
  nextGameDate,
  playerDayPath,
  refreshReportSlates,
  reportDayPath,
  timedFetchJson,
} from "./live-availability";
import { buildModelViews, type ModelViews } from "./model-views";
import { loadCarriedDelta, loadScorePrior } from "./score-prior";
import {
  STINT_BACKFILL_PER_RUN,
  addStintGame,
  backfillStints,
  loadStintDays,
  stintDayPath,
  stintGameFromSummary,
} from "./stint-collect";
import type { StintDay } from "../../src/lib/score/live-stints";
import { parseReportPdf } from "./report-pdf";
import { expectedSiteFiles, publishedSiteFiles } from "./site-files";
import { ledgerProblems } from "./verify-ledger";

const SEASON = LIVE_SEASON;
const LABEL = seasonLabel(SEASON);
const STATE_PATH = path.join(LIVE_DIRECTORY, "state.json");
const LEDGER_PATH = path.join(LIVE_DIRECTORY, "ledger", `${LABEL}.jsonl`);
const SNAPSHOT_DIRECTORY = path.join(LIVE_DIRECTORY, "snapshots", LABEL);
const INJURY_DIRECTORY = path.join(LIVE_DIRECTORY, "injuries", LABEL);
const HEALTH_PATH = path.join(LIVE_DIRECTORY, "health.json");
const HEARTBEAT_PATH = path.join(LIVE_DIRECTORY, "heartbeat.json");
const HEARTBEAT_DAYS = 7;
const REPORT_DIRECTORY = path.join(LIVE_DIRECTORY, "reports", LABEL);

const MODEL: InjuryModel = {
  params: LIVE_PARAMS,
  injury: INJURY_PARAMS,
  statusTable: INJURY_STATUS_TABLE,
  survival: INJURY_SURVIVAL,
};

const nowIso = process.env.LIVE_NOW ?? new Date().toISOString();
const dryRun = process.env.LIVE_DRY_RUN === "1";
const runId = process.env.GITHUB_RUN_ID ?? "local";
const fetchJson = createFetchJson({ headers: { "user-agent": "playoff-pulse-live" } });

function log(message: string): void {
  console.log(`[live] ${message}`);
}

function readJson<T>(file: string): T | null {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as T) : null;
}

function writeText(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf-8");
}

function readLedger(): LedgerRow[] {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs
    .readFileSync(LEDGER_PATH, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerRow);
}

async function fetchFullSchedule(): Promise<SeasonGame[]> {
  const byId = new Map<string, SeasonGame>();
  for (const team of SEASON_TEAMS) {
    for (const seasonType of [2, 3, 5] as const) {
      const events = await fetchTeamSchedule(fetchJson, team.id, SEASON, seasonType);
      for (const game of parseEvents(events, SEASON).games) byId.set(game.id, game);
    }
  }
  return [...byId.values()].sort(compareGames);
}

function assertPlausibleSchedule(games: readonly SeasonGame[]): void {
  const format = seasonFormat(SEASON);
  const counts = new Map<string, number>();
  for (const game of games) {
    if (game.kind !== "regular") continue;
    if (game.status === "postponed" || game.status === "canceled") continue;
    counts.set(game.homeId, (counts.get(game.homeId) ?? 0) + 1);
    counts.set(game.awayId, (counts.get(game.awayId) ?? 0) + 1);
  }
  for (const team of SEASON_TEAMS) {
    const count = counts.get(team.id) ?? 0;
    if (count > format.gamesPerTeam) {
      throw new Error(`${team.abbreviation} has ${count} regular games, above the format's total.`);
    }
    if (count < format.gamesPerTeam - 10) {
      throw new Error(`${team.abbreviation} has only ${count} regular games on the schedule.`);
    }
  }
}

function roundValue(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function roundForecast(forecast: SeasonForecast): SeasonForecast {
  return {
    ...forecast,
    teams: forecast.teams.map((team) => ({
      ...team,
      rating: roundValue(team.rating, 3),
      ratingSd: roundValue(team.ratingSd, 3),
      projectedWins: roundValue(team.projectedWins, 2),
      seedProbabilities: team.seedProbabilities.map((value) => roundValue(value, 4)),
      topSix: roundValue(team.topSix, 4),
      playIn: roundValue(team.playIn, 4),
      makePlayoffs: roundValue(team.makePlayoffs, 4),
      reachSemifinals: roundValue(team.reachSemifinals, 4),
      reachConferenceFinals: roundValue(team.reachConferenceFinals, 4),
      reachFinals: roundValue(team.reachFinals, 4),
      champion: roundValue(team.champion, 4),
    })),
    sums: {
      champion: roundValue(forecast.sums.champion, 6),
      makePlayoffs: roundValue(forecast.sums.makePlayoffs, 6),
      topSix: roundValue(forecast.sums.topSix, 6),
      playIn: roundValue(forecast.sums.playIn, 6),
    },
  };
}

/**
 * Writes state when its content changed, or when the last write is getting old. A newer
 * injury report with the same content is not a change: it would deploy the site for a
 * timestamp alone.
 */
function publishState(state: LiveState): boolean {
  const existing = readJson<LiveState>(STATE_PATH);
  const comparable = (value: LiveState) =>
    JSON.stringify({
      ...value,
      generatedAt: "",
      availability: value.availability ? { ...value.availability, reportAt: "" } : null,
    });
  const publish = shouldPublishState({
    previousGeneratedAt: existing?.generatedAt ?? null,
    contentChanged: !existing || comparable(existing) !== comparable(state),
    nowIso: state.generatedAt,
  });
  if (publish) writeText(STATE_PATH, `${JSON.stringify(state)}\n`);
  return publish;
}

/**
 * The compact copies of the ledger the site fetches at request time, and the manifest
 * of content hashes it keys its cache on (src/lib/season/site-files.ts). Rewritten from
 * the files on disk after everything else, so they always match this run's ledger,
 * state and games; unchanged files are rewritten byte for byte and commit nothing.
 */
function publishSiteFiles(): void {
  const files = expectedSiteFiles(LIVE_DIRECTORY, SEASON, LABEL);
  for (const [relative, content] of files) {
    const file = path.join(LIVE_DIRECTORY, relative);
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf-8") !== content) writeText(file, content);
  }
  log(`site files: ${files.size - 1} derived from the ledger, manifest updated`);
}

/**
 * Writes the model views that changed and removes any view file the run did not produce,
 * so the site never reads a view computed from older inputs than the rest. With no views
 * (they failed), every view file is removed.
 */
function publishModelViews(views: ModelViews | null): void {
  const files = views?.files ?? new Map<string, string>();
  for (const relative of publishedSiteFiles(LIVE_DIRECTORY).keys()) {
    if (isModelViewPath(relative, LABEL) && !files.has(relative)) fs.rmSync(path.join(LIVE_DIRECTORY, relative));
  }
  let written = 0;
  for (const [relative, content] of files) {
    const file = path.join(LIVE_DIRECTORY, relative);
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf-8") !== content) {
      writeText(file, content);
      written += 1;
    }
  }
  log(`views: ${files.size} files, ${written} changed`);
}

/** Every stored report day for the live season, by ET date. */
function loadReportDays(): Map<string, LiveReportDay> {
  const days = new Map<string, LiveReportDay>();
  if (!fs.existsSync(REPORT_DIRECTORY)) return days;
  for (const file of fs.readdirSync(REPORT_DIRECTORY).sort()) {
    if (!file.endsWith(".json")) continue;
    const day = readJson<LiveReportDay>(path.join(REPORT_DIRECTORY, file));
    if (day) days.set(day.etDate, day);
  }
  return days;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function describeSeal(row: SealRow): string {
  const away = teamById(row.awayId).abbreviation;
  const home = teamById(row.homeId).abbreviation;
  const absence = row.absencePoints
    ? `, absences ${away} ${row.absencePoints.away.toFixed(1)} / ${home} ${row.absencePoints.home.toFixed(1)} pts`
    : "";
  const reference =
    row.referenceHomeWinProbability !== undefined
      ? ` (v1 ${percent(row.referenceHomeWinProbability)})`
      : "";
  const report =
    row.sealKind === undefined
      ? ""
      : row.availabilityMissing
        ? ", no report: availability missing"
        : `, report ${row.reportAt}${row.availabilityStale ? " (stale)" : ""}`;
  return `${row.modelVersion} ${row.sealKind ?? "morning"} seal ${row.gameId} ${away}@${home}: home ${percent(
    row.homeWinProbability,
  )}${reference}${absence}${report}${row.inputsIncomplete ? ", inputs incomplete" : ""}`;
}

function loadHistoryPoints(forecast: SeasonForecast, slate: string): TeamHistoryPoint[] {
  const points: TeamHistoryPoint[] = [];
  if (fs.existsSync(SNAPSHOT_DIRECTORY)) {
    for (const file of fs.readdirSync(SNAPSHOT_DIRECTORY).sort()) {
      const date = file.replace(".json", "");
      if (date === slate) continue;
      const snapshot = readJson<SeasonForecast>(path.join(SNAPSHOT_DIRECTORY, file));
      if (!snapshot) continue;
      points.push({
        date,
        champion: Object.fromEntries(snapshot.teams.map((team) => [team.teamId, team.champion])),
      });
    }
  }
  points.push({
    date: slate,
    champion: Object.fromEntries(forecast.teams.map((team) => [team.teamId, team.champion])),
  });
  return points;
}

async function main(): Promise<void> {
  const slate = slateDateAt(nowIso);
  log(`now ${nowIso}, slate ${slate}, run ${runId}${dryRun ? ", dry run" : ""}`);

  // Standings first: results fetched afterward can only be ahead of them.
  const standings = await fetchStandings(fetchJson, SEASON);

  const previousState = readJson<LiveState>(STATE_PATH);
  const stored = readJson<SeasonGame[]>(gamesPath(SEASON)) ?? [];
  const games = new Map(stored.map((game) => [game.id, game]));

  // The full schedule is refreshed daily. It is authoritative for future games, so
  // a rescheduled game replaces its old entry.
  const needsFullRefresh =
    stored.length === 0 || previousState?.scheduleRefreshedEtDate !== slate;
  if (needsFullRefresh) {
    const schedule = await fetchFullSchedule();
    assertPlausibleSchedule(schedule);
    const finals = stored.filter((game) => game.status === "final");
    const fresh = new Set(schedule.filter((game) => game.status === "final").map((game) => game.id));
    const lost = finals.filter((game) => !fresh.has(game.id));
    if (lost.length > 0) {
      throw new Error(`Schedule refresh lost ${lost.length} final game(s): ${lost[0].id}.`);
    }
    games.clear();
    for (const game of schedule) games.set(game.id, game);
    log(`full schedule refreshed: ${schedule.length} games`);
  }

  const scoreboardRows: ScoreboardRow[] = [];
  for (const offset of [-2, -1, 0, 1]) {
    scoreboardRows.push(
      ...(await fetchScoreboardRows(fetchJson, addDays(slate, offset), SEASON)),
    );
  }
  for (const row of scoreboardRows) games.set(row.game.id, row.game);
  const seasonGames = [...games.values()].sort(compareGames);
  assertPlausibleSchedule(seasonGames);

  const phase = detectPhase(seasonGames, SEASON);
  const observed = phase === "regular-season" ? undefined : buildObservedPostseason(seasonGames);
  const postseasonStarted = seasonGames.some(
    (game) =>
      (game.kind === "play-in" || game.kind === "playoff") &&
      (game.status === "final" || game.status === "in-progress"),
  );
  log(`phase: ${phase}`);
  // Once the regular season ends and before the play-in changes ESPN's seeds, ours
  // must match exactly.
  if (phase !== "regular-season" && !postseasonStarted) {
    const seedProblems = crossCheckSeeds(standings, seasonGames);
    if (seedProblems.length > 0) {
      throw new Error(`Seed cross-check failed: ${seedProblems.join("; ")}`);
    }
  }

  const crossCheck = crossCheckStandings(standings, seasonGames, slate);
  if (crossCheck.failures.length > 0) {
    throw new Error(`Standings cross-check failed: ${crossCheck.failures.join("; ")}`);
  }
  for (const note of crossCheck.lagNotes) log(`cross-check: ${note}`);

  const history = loadHistory(SEASON - 1).sort(compareGames);
  const notes: HealthNote[] = [];

  // Availability first: box scores for new finals, then the injury report for the slate.
  // Both are validated before anything is sealed, and written only at the end.
  const liveBox = loadLiveBoxScores(SEASON);
  const boxRun = await collectBoxScores(liveBox, seasonGames, fetchJson);
  log(
    `box scores: ${boxRun.added.length} stored, ${boxRun.failed.length} failed, ${boxRun.waiting} still missing`,
  );
  for (const failure of boxRun.failed) {
    log(`box score ${failure.gameId} not stored: ${failure.problem}`);
    notes.push({
      level: "warning",
      message: `The box score for game ${failure.gameId} could not be stored (${failure.problem}). Its margin updates ratings unadjusted until a later run stores it.`,
    });
  }
  if (boxRun.waiting > boxRun.failed.length) {
    notes.push({
      level: "info",
      message: `${boxRun.waiting - boxRun.failed.length} final game(s) are waiting for a box score; a few are fetched each run.`,
    });
  }

  const slateGames = seasonGames.filter(
    (game) => game.etDate === slate && game.status !== "postponed" && game.status !== "canceled",
  );
  const reportDays = loadReportDays();
  let reportDay = reportDays.get(slate) ?? loadReportDay(LABEL, slate);
  let reportChanged = false;
  let chosen: ChosenReport;
  // The next ET date with games is fetched for too: the NBA lists the next day's games on
  // the evening report. One download serves both slates, each cut and validated with its
  // own games. The current slate leads exactly as it always did, so the report a seal
  // uses is chosen by the same rule from the same downloads; the next slate's day file
  // only gains reports, at or before now, that it would otherwise have fetched later.
  const slateActive = slateGames.some((game) => game.status === "scheduled" || game.status === "in-progress");
  const next = nextGameDate(seasonGames, slate);
  const nextActive = next !== null && next.games.some((game) => game.status === "scheduled");
  let nextDay = next ? (reportDays.get(next.etDate) ?? null) : null;
  let nextChanged = false;
  let nextSucceeded = false;
  let slateSucceeded = false;
  if (slateActive || nextActive) {
    const refresh = await refreshReportSlates({
      nowIso,
      slates: [
        ...(slateActive ? [{ etDate: slate, games: slateGames, day: reportDay }] : []),
        ...(next && nextActive ? [{ etDate: next.etDate, games: next.games, day: nextDay }] : []),
      ],
      parse: parseReportPdf,
    });
    for (const line of refresh.log) log(line);
    for (const result of refresh.slates) {
      if (result.etDate === slate) {
        reportDay = result.day;
        reportChanged = result.changed;
        slateSucceeded = result.succeeded;
      } else {
        nextDay = result.day;
        nextChanged = result.changed;
        nextSucceeded = result.succeeded;
      }
    }
  }
  if (slateActive) {
    chosen = chooseReport(reportDay, slateSucceeded, nowIso);
  } else {
    // Nothing left to seal on this slate, so no report is needed.
    const latest = latestReport(reportDay, etWallClockOf(nowIso));
    chosen = { at: latest?.at ?? null, report: latest?.report ?? null, stale: false, missing: false };
  }
  if (reportDay) reportDays.set(slate, reportDay);
  log(
    `availability: ${
      chosen.missing
        ? "no usable report under 24 hours old, absences are zero"
        : chosen.at
          ? `report ${chosen.at}${chosen.stale ? ", stale: this run could not read a newer one" : ""}`
          : "no report needed"
    }`,
  );
  if (chosen.stale) {
    notes.push({
      level: "warning",
      message: `This run could not read the latest NBA injury report, so it uses the one from ${chosen.at} ET and flags anything it seals.`,
    });
  }
  if (chosen.missing) {
    notes.push({
      level: "warning",
      message: "No usable NBA injury report under 24 hours old: anything sealed now has no absences in it and says so.",
    });
  }

  const live = loadLiveAvailability(SEASON, liveBox, seasonGames, (etDate) => reportDays.get(etDate) ?? null);
  const reportPoint =
    chosen.report && chosen.at
      ? toReportPoint(chosen.report, chosen.at, (teamId, printed) => live.resolve(SEASON, teamId, printed))
      : null;
  if (reportPoint) {
    const unresolved = reportPoint.rows
      .map((row, index) => (row.athleteId === null ? reportPoint.printed[index] : null))
      .filter((name): name is string => name !== null);
    if (unresolved.length > 0) {
      log(`report names not matched (counted as zero): ${unresolved.join("; ")}`);
    }
  }
  const reportInUse = { point: chosen.missing ? null : reportPoint, stale: chosen.stale, missing: chosen.missing };
  const injuryReportProblem = reportProblem({
    day: reportDay,
    chosen,
    scheduledTips: slateGames.filter((game) => game.status === "scheduled").map((game) => game.tipUtc),
    nowIso,
    names: {
      rows: reportPoint?.rows.length ?? 0,
      unresolved: reportPoint?.rows.filter((row) => row.athleteId === null).length ?? 0,
    },
  });
  if (injuryReportProblem) log(`report problem: ${injuryReportProblem}`);

  // Ledger: seals, then misses, then results. Rows are only ever appended.
  const ledger = readLedger();
  const marketById = new Map<string, MarketReference | null>(
    scoreboardRows.map((row) => [row.game.id, row.market]),
  );
  const marketFor = (gameId: string) => marketById.get(gameId) ?? null;
  // v1 keeps sealing its own morning rows exactly as before.
  const referenceSeals = sealGames(
    decideSeals(seasonGames, sealedGameIds(ledger, REFERENCE_MODEL_VERSION, "morning"), nowIso),
    {
      history,
      seasonGames,
      params: LIVE_PARAMS,
      modelVersion: REFERENCE_MODEL_VERSION,
      runId,
      nowIso,
      marketFor,
    },
  );
  const injuryDecisions: InjurySealDecision[] = [
    ...decideSeals(seasonGames, sealedGameIds(ledger, LIVE_MODEL_VERSION, "morning"), nowIso, "morning").map(
      (decision) => ({ ...decision, kind: "morning" as const }),
    ),
    ...(reportInUse.point
      ? decideReissues(seasonGames, ledger, nowIso, LIVE_MODEL_VERSION, slate).map((decision) => ({
          ...decision,
          kind: "reissued" as const,
        }))
      : []),
    ...decideSeals(seasonGames, sealedGameIds(ledger, LIVE_MODEL_VERSION, "final"), nowIso, "final").map(
      (decision) => ({ ...decision, kind: "final" as const }),
    ),
  ];
  const injurySeals = sealInjuryGames(injuryDecisions, {
    history,
    seasonGames,
    model: MODEL,
    modelVersion: LIVE_MODEL_VERSION,
    referenceModelVersion: REFERENCE_MODEL_VERSION,
    runId,
    nowIso,
    source: live.source,
    report: reportInUse,
    nameOf: live.nameOf,
    marketFor,
  });
  for (const row of [...referenceSeals, ...injurySeals]) {
    log(`${dryRun ? "dry run, would write " : ""}${describeSeal(row)}`);
  }
  const seals: SealRow[] = dryRun ? [] : [...referenceSeals, ...injurySeals];
  const afterSeals: LedgerRow[] = [...ledger, ...seals];
  const missed = dryRun
    ? []
    : [
        ...decideMissed(seasonGames, afterSeals, nowIso, REFERENCE_MODEL_VERSION),
        ...decideMissed(seasonGames, afterSeals, nowIso, LIVE_MODEL_VERSION),
      ];
  const afterMissed: LedgerRow[] = [...afterSeals, ...missed];
  const results = dryRun ? [] : decideResults(seasonGames, afterMissed, nowIso);
  const newRows: LedgerRow[] = [...seals, ...missed, ...results];
  const fullLedger: LedgerRow[] = [...afterMissed, ...results];
  // The rows this run writes, or in a dry run would write, must pass the ledger rules
  // before anything is written.
  const problems = ledgerProblems(dryRun ? [...ledger, ...referenceSeals, ...injurySeals] : fullLedger);
  if (problems.length > 0) throw new Error(`Ledger rows failed validation: ${problems.join("; ")}`);
  log(`ledger: ${seals.length} sealed, ${missed.length} missed, ${results.length} results`);

  // Published ratings are full strength and include everything final so far. The run's
  // report is the latest word on teams whose game today has not finished.
  const display = replayFullStrength([...history, ...seasonGames], MODEL, live.source, {
    asOfEtDate: slate,
  });
  forgetEarlierSeasonReports(display.tracker, seasonGames, live.source);
  applyLatestReport(
    display.tracker,
    reportInUse.point,
    slateGames
      .filter((game) => game.status !== "final")
      .flatMap((game) => [game.homeId, game.awayId]),
  );
  const availability = seasonAvailability(display.tracker, MODEL, seasonGames);
  const forecast = roundForecast(
    simulateSeason({
      season: SEASON,
      phase,
      observed,
      games: seasonGames,
      state: display.state,
      params: LIVE_PARAMS,
      asOfEtDate: slate,
      lastGameEtDate: display.lastGameEtDate,
      iterations: LIVE_SIMULATION_ITERATIONS,
      uncertaintyScale: SIMULATOR_UNCERTAINTY_SCALE,
      absences: availability.simulation,
    }),
  );
  const absences = publishAbsences(availability.current, display.tracker, live.nameOf);
  const absencePoints = Object.fromEntries(
    SEASON_TEAMS.map((team) => [team.id, roundValue(availability.absencePoints[team.id], 3)]),
  );
  const currentRatings = Object.fromEntries(
    forecast.teams.map((team) => [team.teamId, roundValue(team.rating - absencePoints[team.teamId], 3)]),
  );
  log(`absences: ${absences.length} players out across ${new Set(absences.map((row) => row.teamId)).size} teams`);

  const ratings = toRatingState(display.state);
  const roundedRatings = {
    mean: ratings.mean.map((value) => roundValue(value)),
    cov: ratings.cov.map((value) => roundValue(value)),
  };
  const stuck = stuckGames(seasonGames, slate);
  for (const game of stuck) {
    notes.push({
      level: "warning",
      message: `Game ${game.id} from ${game.etDate} never went final, and is excluded until it does.`,
    });
  }

  const priorSeasons = history.filter(
    (game) =>
      game.season >= SEASON - 10 && game.kind === "regular" && !game.neutral && game.status === "final",
  );
  const priorHomeWinRate =
    priorSeasons.filter((game) => (game.homeScore as number) > (game.awayScore as number)).length /
    priorSeasons.length;

  const windowFirst = addDays(slate, -1);
  const windowLast = addDays(slate, 1);
  const nextSlate = seasonGames.find(
    (game) =>
      game.etDate >= slate && (game.status === "scheduled" || game.status === "in-progress"),
  );

  const records = {
    [LIVE_MODEL_VERSION]: summarizeRecord(fullLedger, LIVE_MODEL_VERSION, priorHomeWinRate, {
      finalSeals: true,
    }),
    [REFERENCE_MODEL_VERSION]: summarizeRecord(fullLedger, REFERENCE_MODEL_VERSION, priorHomeWinRate, {
      finalSeals: false,
    }),
  };

  const state: LiveState = {
    schemaVersion: 2,
    season: SEASON,
    seasonLabel: LABEL,
    modelVersion: LIVE_MODEL_VERSION,
    referenceModelVersion: REFERENCE_MODEL_VERSION,
    paramsHash: injuryModelHash(MODEL),
    generatedAt: nowIso,
    scheduleRefreshedEtDate: needsFullRefresh
      ? slate
      : (previousState?.scheduleRefreshedEtDate ?? slate),
    ratingsThroughUtc: display.ratingsThroughUtc,
    ratingsHash: ratingsHash(ratings),
    teamOrder: SEASON_TEAMS.map((team) => team.id),
    ratings: roundedRatings,
    teamGameDates: teamGameDatesAround(seasonGames, slate),
    params: LIVE_PARAMS,
    injury: { params: INJURY_PARAMS, statusTable: INJURY_STATUS_TABLE, survival: INJURY_SURVIVAL },
    availability: { reportAt: chosen.at, stale: chosen.stale, missing: chosen.missing },
    absences,
    absencePoints,
    currentRatings,
    slateEtDate: slate,
    nextSlateEtDate: nextSlate?.etDate ?? null,
    ledgerStartedAt: fullLedger.reduce<string | null>(
      (earliest, row) =>
        row.type === "seal" && (earliest === null || row.issuedAt < earliest)
          ? row.issuedAt
          : earliest,
      null,
    ),
    seals: sealsByGame(fullLedger, windowFirst, windowLast),
    forecast,
    record: records[LIVE_MODEL_VERSION],
    records,
    history: loadHistoryPoints(forecast, slate),
    notes,
  };

  // Model views for the site: projections with the injury term for the next seven days,
  // each team's injury list for its next game, and player files from the full box-score
  // store. None of it is a model input, a seal or part of the record. A failure here is
  // logged and publishes no views, and never costs a seal.
  let playerDays = new Map<string, PlayerGamesDay>();
  let playerRun: Awaited<ReturnType<typeof collectPlayerGames>> = {
    added: [],
    changedDates: [],
    failed: [],
    waiting: 0,
    requests: 0,
    summaryProblems: [],
  };
  let views: ModelViews | null = null;
  let viewsProblem: string | null = null;
  // The 548 score (display only, never a forecast input) reads its prior and its carried
  // on-court δ from the code checkout. Without the prior the index is published with every
  // score null; without the δ or the stints, with box scores alone. health.json says why
  // (`scoreProblem`); seals and the other views are unaffected.
  const scorePrior = loadScorePrior(SEASON);
  const scoreCarried = loadCarriedDelta(SEASON);
  let scoreProblem: string | null = null;
  // The 548 score's stints (display only): built from the summary each new game's player
  // lines come from, plus a small backfill of stored games without them inside the same
  // request cap and time budget. Every step is caught here, so stints never fail the job,
  // never cost a game its player lines, and never stop the views.
  let stintDays: Map<string, StintDay> | null = null;
  let stintProblem: string | null = null;
  const stintChanged = new Set<string>();
  try {
    stintDays = loadStintDays(LABEL);
  } catch (error) {
    stintProblem = `stints unreadable: ${error instanceof Error ? error.message : String(error)}`;
    log(`548 score stints not used this run, seals and views unaffected: ${stintProblem}`);
  }
  try {
    playerDays = loadPlayerDays(LABEL);
    const started = Date.now();
    const stintRejected: string[] = [];
    playerRun = await collectPlayerGames(playerDays, seasonGames, timedFetchJson(), {
      onSummary: (game, payload) => {
        if (!stintDays) return;
        const stored = stintGameFromSummary(payload, game);
        stintChanged.add(addStintGame(stintDays, stored));
        if (stored.stints === null) stintRejected.push(`${game.id} (${stored.audit.rejected})`);
      },
    });
    log(
      `player lines: ${playerRun.added.length} games stored in ${((Date.now() - started) / 1000).toFixed(1)}s, ${playerRun.failed.length} failed, ${playerRun.waiting} still missing`,
    );
    for (const failure of playerRun.failed) log(`player lines ${failure.gameId} not stored: ${failure.problem}`);
    for (const failure of playerRun.summaryProblems) log(`548 score stints ${failure.gameId} not built: ${failure.problem}`);
    if (stintDays) {
      try {
        const backfill = await backfillStints({
          stintDays,
          playerDays,
          games: seasonGames,
          fetchJson: timedFetchJson(),
          // Together with the player lines, never more summary requests or time than before.
          maxRequests: Math.min(STINT_BACKFILL_PER_RUN, PLAYER_GAMES_PER_RUN - playerRun.requests),
          deadline: started + PLAYER_GAMES_BUDGET_MS,
        });
        for (const etDate of backfill.changedDates) stintChanged.add(etDate);
        for (const rejected of backfill.rejected) stintRejected.push(`${rejected.gameId} (${rejected.reason})`);
        for (const failure of backfill.failed) log(`548 score stints ${failure.gameId} not fetched: ${failure.problem}`);
        log(
          `548 score stints: ${playerRun.added.length - playerRun.summaryProblems.length} with new games, ${backfill.added.length} backfilled ` +
            `(${backfill.requests} requests), ${stintRejected.length} rejected, ${backfill.waiting} stored games still without stints`,
        );
      } catch (error) {
        log(`548 score stint backfill stopped, seals and views unaffected: ${error instanceof Error ? error.message : String(error)}`);
      }
      for (const rejected of stintRejected) log(`548 score stints rejected: ${rejected}`);
    }
    const nextReport =
      next && nextDay ? chooseReport(nextDay, nextSucceeded, nowIso) : null;
    views = buildModelViews({
      season: SEASON,
      seasonLabel: LABEL,
      modelVersion: LIVE_MODEL_VERSION,
      games: seasonGames,
      slate,
      state,
      model: MODEL,
      tracker: display.tracker,
      current: availability.current,
      slateReport:
        reportInUse.point && chosen.at && reportDay
          ? { etDate: slate, point: reportInUse.point, stale: chosen.stale, file: reportDay.reports[chosen.at]?.file ?? null }
          : null,
      nextReport:
        next && nextReport && !nextReport.missing && nextReport.report && nextReport.at
          ? {
              etDate: next.etDate,
              point: toReportPoint(nextReport.report, nextReport.at, (teamId, printed) => live.resolve(SEASON, teamId, printed)),
              stale: nextReport.stale,
              file: nextReport.report.file,
            }
          : null,
      reportDays: (etDate) => reportDays.get(etDate) ?? (etDate === slate ? reportDay : null),
      resolve: (teamId, printed) => live.resolve(SEASON, teamId, printed),
      nameOf: live.nameOf,
      playerDays: [...playerDays.values()],
      ledger: fullLedger,
      scorePrior: scorePrior.prior,
      scorePriorProblem: scorePrior.problem,
      scoreCarried: scoreCarried.carried,
      scoreCarriedProblem: scoreCarried.problem,
      stintDays: stintDays ? [...stintDays.values()] : null,
      stintProblem,
    });
    scoreProblem = views.scoreProblem;
    if (scoreProblem) log(`548 score not fully published, views and seals unaffected: ${scoreProblem}`);
    if (views.score.onCourt) {
      const { checkpoint, rows, stintGames, firstGame } = views.score.onCourt;
      log(
        `548 score: ${views.score.model}, on-court part ${checkpoint ? `from the ${checkpoint} checkpoint (${stintGames} games, ${rows} stints)` : `carried (first checkpoint ${firstGame ? "after" : "once"} the season's first game${firstGame ? ` ${firstGame}` : " is stored"})`}`,
      );
    }
    log(
      `views: ${views.projections.games.length} projections through ${views.projections.throughEtDate}, ${views.players.index.players.length} players, ${views.players.teams.size} team files`,
    );
  } catch (error) {
    viewsProblem = error instanceof Error ? error.message : String(error);
    views = null;
    log(`views not published, seals unaffected: ${viewsProblem}`);
  }

  // Everything validated. Only now does anything get written.
  writeText(gamesPath(SEASON), `${JSON.stringify(seasonGames.map(withoutLiveScores))}\n`);
  if (newRows.length > 0) {
    fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
    fs.appendFileSync(
      LEDGER_PATH,
      `${newRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
      "utf-8",
    );
  }
  if (boxRun.added.length > 0) {
    writeText(liveBoxScorePath(SEASON), `${JSON.stringify(liveBox)}\n`);
  }
  if (reportChanged && reportDay) {
    writeText(reportDayPath(LABEL, slate), `${JSON.stringify(reportDay)}\n`);
  }
  if (next && nextChanged && nextDay) {
    writeText(reportDayPath(LABEL, next.etDate), `${JSON.stringify(nextDay)}\n`);
  }
  for (const etDate of playerRun.changedDates) {
    const day = playerDays.get(etDate);
    if (day) writeText(playerDayPath(LABEL, etDate), `${JSON.stringify(day)}\n`);
  }
  // The 548 score's stints, display only: a write that fails is logged and costs nothing else.
  for (const etDate of [...stintChanged].sort()) {
    const day = stintDays?.get(etDate);
    if (!day) continue;
    try {
      writeText(stintDayPath(LABEL, etDate), `${JSON.stringify(day)}\n`);
    } catch (error) {
      log(`548 score stints ${etDate} not written: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // ESPN's injury list, kept for later study only: at every seal, as before, and
  // whenever it changes, with ESPN's return dates. Never a model input.
  try {
    const injuries: InjuryRow[] = await fetchInjuries(fetchJson);
    const file = path.join(INJURY_DIRECTORY, `${slate}.json`);
    const captures = readJson<Array<{ capturedAt: string; rows: InjuryRow[] }>>(file) ?? [];
    const last = captures.at(-1);
    if (seals.length > 0 || !last || JSON.stringify(last.rows) !== JSON.stringify(injuries)) {
      captures.push({ capturedAt: nowIso, rows: injuries });
      writeText(file, `${JSON.stringify(captures)}\n`);
    }
  } catch (error) {
    log(`injury capture failed, seals unaffected: ${String(error)}`);
  }
  writeText(path.join(SNAPSHOT_DIRECTORY, `${slate}.json`), `${JSON.stringify(forecast)}\n`);
  const changed = publishState(state);
  log(changed ? "state published" : "state unchanged");
  publishModelViews(views);
  publishSiteFiles();

  const healthBody = {
    stuckGames: stuck.map((game) => ({ id: game.id, etDate: game.etDate })),
    standingsLag: crossCheck.lagNotes,
    reportProblem: injuryReportProblem,
    viewsProblem,
    // Only while the views are published: a views failure already says the index is missing.
    scoreProblem: views ? scoreProblem : null,
  };
  const previousHealth = readJson<typeof healthBody & { generatedAt: string }>(HEALTH_PATH);
  if (
    !previousHealth ||
    JSON.stringify({ ...previousHealth, generatedAt: undefined }) !==
      JSON.stringify({ ...healthBody, generatedAt: undefined })
  ) {
    writeText(HEALTH_PATH, `${JSON.stringify({ generatedAt: nowIso, ...healthBody })}\n`);
  }

  // Scheduled workflows stop after 60 quiet days, so never go that long.
  const heartbeat = readJson<{ date: string }>(HEARTBEAT_PATH);
  const heartbeatAge = heartbeat
    ? (Date.parse(`${slate}T12:00:00Z`) - Date.parse(`${heartbeat.date}T12:00:00Z`)) / 86_400_000
    : Number.POSITIVE_INFINITY;
  if (heartbeatAge >= HEARTBEAT_DAYS) {
    writeText(HEARTBEAT_PATH, `${JSON.stringify({ date: slate })}\n`);
  }

  log(
    `done. Title favorite: ${
      [...forecast.teams].sort((a, b) => b.champion - a.champion)[0].teamId
    }. Sums: ${JSON.stringify(forecast.sums)}`,
  );
}

main().catch((error) => {
  console.error(`[live] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
