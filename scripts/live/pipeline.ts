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
  collectBoxScores,
  liveBoxScorePath,
  loadLiveAvailability,
  loadLiveBoxScores,
  loadReportDay,
  refreshReports,
  reportDayPath,
} from "./live-availability";
import { parseReportPdf } from "./report-pdf";
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
  if (slateGames.some((game) => game.status === "scheduled" || game.status === "in-progress")) {
    const refresh = await refreshReports({
      nowIso,
      slate,
      slateGames,
      day: reportDay,
      parse: parseReportPdf,
    });
    for (const line of refresh.log) log(line);
    reportDay = refresh.day;
    reportChanged = refresh.changed;
    chosen = chooseReport(reportDay, refresh.succeeded, nowIso);
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

  const healthBody = {
    stuckGames: stuck.map((game) => ({ id: game.id, etDate: game.etDate })),
    standingsLag: crossCheck.lagNotes,
    reportProblem: injuryReportProblem,
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
