// The live forecast job: fetch, validate, seal, simulate, publish. Any failure
// exits non-zero before anything is written, so the last good state stays up.
//
// Run: corepack pnpm live:pipeline
// LIVE_NOW overrides the clock. LIVE_DRY_RUN=1 writes state but seals nothing.

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
import { addDays } from "../../src/lib/season/dates";
import { seasonFormat, seasonLabel } from "../../src/lib/season/formats";
import {
  crossCheckStandings,
  decideMissed,
  decideResults,
  decideSeals,
  sealGames,
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
  LIVE_MODEL_VERSION,
  LIVE_PARAMS,
  LIVE_SIMULATION_ITERATIONS,
  SIMULATOR_UNCERTAINTY_SCALE,
} from "../../src/lib/season/params";
import {
  paramsHash,
  ratingsHash,
  replayRatings,
  toRatingState,
} from "../../src/lib/season/ratings";
import { simulateSeason } from "../../src/lib/season/simulate";
import { SEASON_TEAMS } from "../../src/lib/season/teams";
import type {
  HealthNote,
  LedgerRow,
  LiveState,
  MarketReference,
  SeasonForecast,
  SeasonGame,
  TeamHistoryPoint,
} from "../../src/lib/season/types";
import { compareGames, gamesPath, LIVE_DIRECTORY, LIVE_SEASON, loadHistory } from "./game-store";

const SEASON = LIVE_SEASON;
const LABEL = seasonLabel(SEASON);
const STATE_PATH = path.join(LIVE_DIRECTORY, "state.json");
const LEDGER_PATH = path.join(LIVE_DIRECTORY, "ledger", `${LABEL}.jsonl`);
const SNAPSHOT_DIRECTORY = path.join(LIVE_DIRECTORY, "snapshots", LABEL);
const INJURY_DIRECTORY = path.join(LIVE_DIRECTORY, "injuries", LABEL);
const HEALTH_PATH = path.join(LIVE_DIRECTORY, "health.json");
const HEARTBEAT_PATH = path.join(LIVE_DIRECTORY, "heartbeat.json");
const HEARTBEAT_DAYS = 7;

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

/** Writes state when its content changed, or when the last write is getting old. */
function publishState(state: LiveState): boolean {
  const existing = readJson<LiveState>(STATE_PATH);
  const comparable = (value: LiveState) => JSON.stringify({ ...value, generatedAt: "" });
  const publish = shouldPublishState({
    previousGeneratedAt: existing?.generatedAt ?? null,
    contentChanged: !existing || comparable(existing) !== comparable(state),
    nowIso: state.generatedAt,
  });
  if (publish) writeText(STATE_PATH, `${JSON.stringify(state)}\n`);
  return publish;
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

  // Ledger: seals, then misses, then results. Rows are only ever appended.
  const ledger = readLedger();
  const sealedIds = new Set(
    ledger.filter((row) => row.type === "seal").map((row) => row.gameId),
  );
  const marketById = new Map<string, MarketReference | null>(
    scoreboardRows.map((row) => [row.game.id, row.market]),
  );
  const decisions = dryRun ? [] : decideSeals(seasonGames, sealedIds, nowIso);
  const seals = sealGames(decisions, {
    history,
    seasonGames,
    params: LIVE_PARAMS,
    modelVersion: LIVE_MODEL_VERSION,
    runId,
    nowIso,
    marketFor: (gameId) => marketById.get(gameId) ?? null,
  });
  const afterSeals: LedgerRow[] = [...ledger, ...seals];
  const missed = dryRun ? [] : decideMissed(seasonGames, afterSeals, nowIso);
  const afterMissed: LedgerRow[] = [...afterSeals, ...missed];
  const results = dryRun ? [] : decideResults(seasonGames, afterMissed, nowIso);
  const newRows: LedgerRow[] = [...seals, ...missed, ...results];
  const fullLedger: LedgerRow[] = [...afterMissed, ...results];
  log(`ledger: ${seals.length} sealed, ${missed.length} missed, ${results.length} results`);

  // Ratings for display include everything final so far.
  const display = replayRatings([...history, ...seasonGames], LIVE_PARAMS, {
    asOfEtDate: slate,
  });
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
    }),
  );

  const ratings = toRatingState(display.state);
  const roundedRatings = {
    mean: ratings.mean.map((value) => roundValue(value)),
    cov: ratings.cov.map((value) => roundValue(value)),
  };
  const notes: HealthNote[] = [];
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

  const state: LiveState = {
    schemaVersion: 1,
    season: SEASON,
    seasonLabel: LABEL,
    modelVersion: LIVE_MODEL_VERSION,
    paramsHash: paramsHash(LIVE_PARAMS),
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
    slateEtDate: slate,
    nextSlateEtDate: nextSlate?.etDate ?? null,
    ledgerStartedAt: fullLedger.reduce<string | null>(
      (earliest, row) =>
        row.type === "seal" && (earliest === null || row.issuedAt < earliest)
          ? row.issuedAt
          : earliest,
      null,
    ),
    seals: Object.fromEntries(
      fullLedger.flatMap((row) =>
        row.type === "seal" && row.etDate >= windowFirst && row.etDate <= windowLast
          ? [[row.gameId, row]]
          : [],
      ),
    ),
    forecast,
    record: summarizeRecord(fullLedger, LIVE_MODEL_VERSION, priorHomeWinRate),
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
  if (seals.length > 0) {
    // Availability at the moment of sealing, kept for later study only.
    try {
      const injuries = await fetchInjuries(fetchJson);
      const file = path.join(INJURY_DIRECTORY, `${slate}.json`);
      const captures = readJson<unknown[]>(file) ?? [];
      captures.push({ capturedAt: nowIso, rows: injuries });
      writeText(file, `${JSON.stringify(captures)}\n`);
    } catch (error) {
      log(`injury capture failed, seals unaffected: ${String(error)}`);
    }
  }
  writeText(path.join(SNAPSHOT_DIRECTORY, `${slate}.json`), `${JSON.stringify(forecast)}\n`);
  const changed = publishState(state);
  log(changed ? "state published" : "state unchanged");

  const healthBody = {
    stuckGames: stuck.map((game) => ({ id: game.id, etDate: game.etDate })),
    standingsLag: crossCheck.lagNotes,
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
