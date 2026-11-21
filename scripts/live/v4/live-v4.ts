// v4 in the live job (registration-v4.md, W1 to W3): shadow seals beside v2 and v1, and the
// shadow file. The job calls `shadowV4` last, inside its own guard: whatever happens here,
// v1's and v2's rows, the v2 record, state.json and the projections are already fixed.
// v4 reads the committed warm checkpoint (the state after 2025-26) and replays the live
// season from the stored player lines; it never writes under data/live except through the
// job (`data/live/site/{season}/shadow-v4.json` and its ledger rows).

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { buildV4Season, lostPoints } from "../../../src/lib/season/availability-v4";
import type { ReportPoint } from "../../../src/lib/season/injury-model";
import type { AvailabilitySource, ReportInUse } from "../../../src/lib/season/live-injury";
import {
  decideMissed,
  decideReissues,
  decideSeals,
  scoredSeal,
  sealedGameIds,
  sealGames,
  summarizeRecord,
  type SealDecision,
} from "../../../src/lib/season/live-state";
import { clampProbability } from "../../../src/lib/season/math";
import { LIVE_PARAMS, LIVE_SIMULATION_ITERATIONS, LIVE_MODEL_VERSION, REFERENCE_MODEL_VERSION } from "../../../src/lib/season/params";
import { V4_FIRST_ET_DATE, V4_FROZEN, V4_MODEL_VERSION, V4_WARM_SHA256 } from "../../../src/lib/season/params-v4";
import type { PlayerGamesDay } from "../../../src/lib/season/player-stats";
import { createFilterState } from "../../../src/lib/season/ratings";
import {
  advanceTo,
  copyRosterState,
  forecastGame,
  replayRosterState,
  sideListing,
  type RosterState,
  type SideListing,
  type V4GameLines,
  type V4Line,
} from "../../../src/lib/season/roster-state";
import { simulateSeason, type ObservedPostseason } from "../../../src/lib/season/simulate";
import { SEASON_TEAMS } from "../../../src/lib/season/teams";
import type { LedgerRow, MarketReference, SealKind, SealRow, SeasonGame, SeasonPhase } from "../../../src/lib/season/types";
import { deserializeRosterState } from "./engine-run";

export const WARM_CHECKPOINT = "data/season/v4/warm-2026.bin.gz";
export const SHADOW_FILE = (seasonLabel: string) => `site/${seasonLabel}/shadow-v4.json`;

export const isV4Row = (row: LedgerRow): boolean => row.type !== "result" && row.modelVersion === V4_MODEL_VERSION;

const round = (value: number, digits: number) => Number(value.toFixed(digits));
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const V4_PARAMS_HASH = sha(JSON.stringify(V4_FROZEN)).slice(0, 16);

export function loadWarmState(root = process.cwd()): RosterState {
  const body = fs.readFileSync(path.join(root, WARM_CHECKPOINT));
  if (sha(body) !== V4_WARM_SHA256) throw new Error("v4 warm checkpoint does not match V4_WARM_SHA256.");
  return deserializeRosterState(zlib.gunzipSync(body));
}

/** The live season's stored player lines as v4 lines: [athlete, minutes, the eleven Stage 1 counts]. */
export function liveLines(days: Iterable<PlayerGamesDay>): Map<string, V4GameLines> {
  const out = new Map<string, V4GameLines>();
  for (const day of days) {
    for (const [gameId, game] of Object.entries(day.games)) {
      const teams: Record<string, V4Line[]> = {};
      for (const [teamId, entry] of Object.entries(game.teams)) {
        teams[teamId] = entry.lines
          .filter((line) => line[2] > 0)
          .map((l) => [l[0], l[2], l[3], l[12], l[16], l[13], l[6], l[9], l[4], l[5], l[7], l[8], l[10]] as V4Line);
      }
      out.set(gameId, teams);
    }
  }
  return out;
}

/** History's rule for the live season (all five games precede the cutover): first-five membership. */
function openingRosters(games: readonly SeasonGame[], lines: Map<string, V4GameLines>, season: number) {
  const counts = new Map<string, number>();
  const sets = new Map<string, Set<string>>();
  for (const game of games.filter((row) => row.season === season && row.kind === "regular" && row.status === "final")) {
    for (const teamId of [game.homeId, game.awayId]) {
      if ((counts.get(teamId) ?? 0) >= 5) continue;
      counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
      const set = sets.get(teamId) ?? new Set<string>();
      for (const line of lines.get(game.id)?.[teamId] ?? []) set.add(line[0]);
      sets.set(teamId, set);
    }
  }
  return new Map([...sets].map(([teamId, set]) => [teamId, [...set].sort()]));
}

export type ShadowInput = {
  season: number;
  seasonLabel: string;
  slate: string;
  nowIso: string;
  runId: string;
  phase: SeasonPhase;
  observed?: ObservedPostseason;
  history: readonly SeasonGame[];
  seasonGames: readonly SeasonGame[];
  /** Every ledger row, v4's included. */
  ledger: readonly LedgerRow[];
  report: ReportInUse;
  source: AvailabilitySource;
  nameOf: (athleteId: string) => string | undefined;
  playerDays: Iterable<PlayerGamesDay>;
  marketFor: (gameId: string) => MarketReference | null;
  priorHomeWinRate: number;
  firstEtDate?: string | null;
  iterations?: number;
};

export type ShadowOutput = { seals: SealRow[]; missed: LedgerRow[]; shadow: unknown | null };

export function shadowV4(input: ShadowInput): ShadowOutput {
  const first = input.firstEtDate === undefined ? V4_FIRST_ET_DATE : input.firstEtDate;
  if (!first || input.slate < first) return { seals: [], missed: [], shadow: null };
  const params = V4_FROZEN.ratings;
  const eligible = (decision: SealDecision) => decision.game.etDate >= first;
  const decisions: Array<SealDecision & { kind: SealKind }> = [
    ...decideSeals(input.seasonGames, sealedGameIds(input.ledger, V4_MODEL_VERSION, "morning"), input.nowIso, "morning")
      .filter(eligible)
      .map((decision) => ({ ...decision, kind: "morning" as const })),
    ...(input.report.point
      ? decideReissues(input.seasonGames, input.ledger, input.nowIso, V4_MODEL_VERSION, input.slate)
          .filter(eligible)
          .map((decision) => ({ ...decision, kind: "reissued" as const }))
      : []),
    ...decideSeals(input.seasonGames, sealedGameIds(input.ledger, V4_MODEL_VERSION, "final"), input.nowIso, "final")
      .filter(eligible)
      .map((decision) => ({ ...decision, kind: "final" as const })),
  ];

  const lines = liveLines(input.playerDays);
  const rosters = openingRosters(input.seasonGames, lines, input.season);
  const finals = input.seasonGames.filter((game) => game.status === "final");
  const reportFor = (game: SeasonGame): ReportPoint | null => input.source.availability(game.id)?.final ?? null;
  const state = loadWarmState();
  const states = new Map<string, RosterState>();
  const dates = [...new Set([...decisions.map((decision) => decision.game.etDate), input.slate])].sort();
  let done = 0;
  for (const date of dates) {
    const slice: SeasonGame[] = [];
    while (done < finals.length && finals[done].etDate < date) slice.push(finals[done++]);
    replayRosterState({
      games: slice,
      linesFor: (id) => lines.get(id),
      reportFor,
      openingRosters: (season) => (season === input.season ? rosters : new Map()),
      params,
      statusTable: () => V4_FROZEN.statusTable,
      state,
    });
    const copy = copyRosterState(state);
    advanceTo(copy, input.season, date, params, () => rosters);
    states.set(date, copy);
  }

  const point = input.report.missing ? null : input.report.point;
  const seals: SealRow[] = [];
  for (const decision of decisions) {
    const { game } = decision;
    const frozen = copyRosterState(states.get(game.etDate) as RosterState);
    const listing = { home: sideListing(point, game.homeId), away: sideListing(point, game.awayId) };
    const forecast = forecastGame(frozen, game, listing, params, V4_FROZEN.statusTable);
    const reference = sealGames([decision], {
      history: input.history,
      seasonGames: input.seasonGames,
      params: LIVE_PARAMS,
      modelVersion: REFERENCE_MODEL_VERSION,
      runId: input.runId,
      nowIso: input.nowIso,
      marketFor: input.marketFor,
    })[0];
    const side = (teamId: string, sideRows: SideListing) => {
      const rows = sideRows === null ? [] : sideRows.unfiled ? frozen.minutes.filedRows.get(teamId) ?? [] : sideRows.rows;
      const drivers = rows
        .filter((row) => frozen.minutes.members.get(teamId)?.has(row.athleteId))
        .map((row) => ({
          athleteId: row.athleteId,
          name: input.nameOf(row.athleteId) ?? row.athleteId,
          status: row.status,
          points: round(V4_FROZEN.statusTable[row.status] * lostPoints(frozen, teamId, row.athleteId, params, game.kind === "playoff"), 3),
        }))
        .filter((driver) => driver.points > 0)
        .sort((a, b) => b.points - a.points || a.athleteId.localeCompare(b.athleteId));
      return { drivers, points: round(drivers.reduce((sum, driver) => sum + driver.points, 0), 3) };
    };
    const home = side(game.homeId, listing.home);
    const away = side(game.awayId, listing.away);
    seals.push({
      type: "seal",
      gameId: game.id,
      etDate: game.etDate,
      tipUtc: game.tipUtc,
      issuedAt: input.nowIso,
      modelVersion: V4_MODEL_VERSION,
      paramsHash: V4_PARAMS_HASH,
      ratingsHash: sha(Buffer.from(frozen.mean.buffer, 0, frozen.n * 8)).slice(0, 16),
      homeId: game.homeId,
      awayId: game.awayId,
      homeWinProbability: round(clampProbability(forecast.homeWinProbability), 6),
      expectedMargin: round(forecast.expectedMargin, 4),
      inputsIncomplete: decision.inputsIncomplete,
      missingGameIds: decision.missingGameIds,
      runId: input.runId,
      market: input.marketFor(game.id),
      sealKind: decision.kind,
      reportAt: point?.at ?? null,
      availabilityStale: input.report.stale,
      availabilityMissing: input.report.missing,
      absence: { home: home.points, away: away.points },
      absencePoints: { home: home.points, away: away.points },
      drivers: { home: home.drivers, away: away.drivers },
      driversComplete: true,
      unfiled: { home: listing.home?.unfiled ?? false, away: listing.away?.unfiled ?? false },
      referenceModelVersion: REFERENCE_MODEL_VERSION,
      referenceHomeWinProbability: reference.homeWinProbability,
    });
  }
  const afterSeals = [...input.ledger, ...seals];
  const missed = decideMissed(input.seasonGames, afterSeals, input.nowIso, V4_MODEL_VERSION);
  const all = [...afterSeals, ...missed];
  return { seals, missed, shadow: shadowFile(input, all, states.get(input.slate) as RosterState, first) };
}

function sameGames(ledger: readonly LedgerRow[]) {
  const results = new Map<string, 0 | 1>();
  for (const row of ledger) if (row.type === "result") results.set(row.gameId, row.homeScore > row.awayScore ? 1 : 0);
  const seals = new Map<string, Map<string, SealRow[]>>();
  for (const row of ledger) {
    if (row.type !== "seal") continue;
    const byGame = seals.get(row.modelVersion) ?? new Map<string, SealRow[]>();
    byGame.set(row.gameId, [...(byGame.get(row.gameId) ?? []), row]);
    seals.set(row.modelVersion, byGame);
  }
  const versions = [V4_MODEL_VERSION, LIVE_MODEL_VERSION, REFERENCE_MODEL_VERSION];
  const games = [...(seals.get(V4_MODEL_VERSION)?.keys() ?? [])].filter(
    (id) => results.has(id) && versions.every((version) => seals.get(version)?.has(id)),
  );
  const score = (version: string) => {
    let brier = 0;
    let logLoss = 0;
    for (const id of games) {
      const p = (scoredSeal(seals.get(version)?.get(id) ?? []) as SealRow).homeWinProbability;
      const y = results.get(id) as 0 | 1;
      brier += (p - y) ** 2;
      logLoss -= y ? Math.log(clampProbability(p)) : Math.log(1 - clampProbability(p));
    }
    return games.length ? { brier: round(brier / games.length, 4), logLoss: round(logLoss / games.length, 4) } : { brier: null, logLoss: null };
  };
  return { games: games.length, v4: score(V4_MODEL_VERSION), v2: score(LIVE_MODEL_VERSION), v1: score(REFERENCE_MODEL_VERSION) };
}

function shadowFile(input: ShadowInput, ledger: readonly LedgerRow[], slateState: RosterState, first: string) {
  const params = V4_FROZEN.ratings;
  const state = copyRosterState(slateState);
  // The report in use is the latest word for teams whose game today has not finished.
  const point = input.report.missing ? null : input.report.point;
  for (const game of input.seasonGames.filter((row) => row.etDate === input.slate && row.status !== "final")) {
    for (const teamId of [game.homeId, game.awayId]) {
      const listing = sideListing(point, teamId);
      if (!listing || listing.unfiled) continue;
      state.minutes.filedRows.set(teamId, listing.rows.map((row) => ({ ...row })));
      const listed = new Set(listing.rows.map((row) => row.athleteId));
      for (const athleteId of state.minutes.members.get(teamId) ?? []) {
        const player = state.minutes.players.get(athleteId);
        if (player) player.listed = listed.has(athleteId);
      }
    }
  }
  const teamIds = SEASON_TEAMS.map((team) => team.id);
  const { input: v4, players } = buildV4Season(state, input.season, teamIds, {
    params,
    statusTable: V4_FROZEN.statusTable,
    hazards: V4_FROZEN.hazards,
    background: V4_FROZEN.background,
    backgroundOn: true,
    horizonDays: V4_FROZEN.horizonDays,
  });
  const lastGameEtDate: Record<string, string | null> = {};
  for (const teamId of teamIds) lastGameEtDate[teamId] = state.teamLastDate.get(teamId) ?? null;
  const forecast = simulateSeason({
    season: input.season,
    phase: input.phase,
    observed: input.observed,
    games: input.seasonGames,
    state: createFilterState(LIVE_PARAMS),
    params: LIVE_PARAMS,
    asOfEtDate: input.slate,
    lastGameEtDate,
    iterations: input.iterations ?? LIVE_SIMULATION_ITERATIONS,
    v4,
  });
  return {
    version: 1,
    modelVersion: V4_MODEL_VERSION,
    label: "In testing: roster-state model v4. Not the published forecast.",
    firstEtDate: first,
    slate: input.slate,
    record: summarizeRecord(ledger, V4_MODEL_VERSION, input.priorHomeWinRate, { finalSeals: true }),
    sameGames: sameGames(ledger),
    teams: forecast.teams.map((team) => ({
      teamId: team.teamId,
      strength: round(team.rating, 3),
      projectedWins: round(team.projectedWins, 2),
      makePlayoffs: round(team.makePlayoffs, 4),
      champion: round(team.champion, 4),
    })),
    sums: forecast.sums,
    absences: players
      .filter((player) => player.listed)
      .map((player) => ({
        teamId: player.teamId,
        athleteId: player.athleteId,
        name: input.nameOf(player.athleteId) ?? player.athleteId,
        status: player.status,
        reason: player.reason,
        points: round(player.points, 3),
        gamesMissed: player.gamesMissed,
      })),
    /** W5: v4's "548 impact" (points his team loses without him), shown only once v4 is published. */
    impact: Object.fromEntries(players.map((player) => [player.athleteId, round(player.points, 3)])),
  };
}
