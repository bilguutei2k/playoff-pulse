// v5 in the live job (docs/live/registration-v5.md, "Wiring as built"): the second shadow model's
// seals beside v2, v1 and v4, and its shadow file. The job calls `shadowV5` after v4, inside its
// own guard: whatever happens here, v1's, v2's and v4's rows, the v2 record, state.json, the
// projections and shadow-v4.json are already fixed. v5 is v4 plus observation 3 (on-court
// plus/minus, s3 = 25): it reads its committed warm checkpoint (the state after 2025-26) and
// replays the live season from the stored player lines, whose plus/minus is its fourth input.
// It writes nothing itself: the job writes its shadow file (`site/{season}/shadow-v5.json` in the
// live data directory) and its ledger rows. Nothing here says v5 is better or worse than any other model.

import { createHash } from "node:crypto";
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
import { V4_FROZEN, V4_MODEL_VERSION } from "../../../src/lib/season/params-v4";
import { V5_FROZEN, V5_MODEL_VERSION, withOnCourt, type V5RatingParams } from "../../../src/lib/season/params-v5";
import { inV5Range, V5_FIRST_ET_DATE, V5_LAST_ET_DATE } from "../../../src/lib/season/params-v5-live";
import type { PlayerGamesDay } from "../../../src/lib/season/player-stats";
import { createFilterState } from "../../../src/lib/season/ratings";
import {
  advanceTo,
  copyRosterState,
  forecastGame,
  refreshScale,
  replayRosterState,
  sideListing,
  type RosterState,
  type SideListing,
  type V4GameLines,
} from "../../../src/lib/season/roster-state-v5";
import { simulateSeason, type ObservedPostseason } from "../../../src/lib/season/simulate";
import { SEASON_TEAMS } from "../../../src/lib/season/teams";
import type { LedgerRow, MarketReference, SealKind, SealRow, SeasonGame, SeasonPhase } from "../../../src/lib/season/types";
import { liveLines } from "../v4/live-v4";
import { loadWarmStateV5 } from "./checkpoint";

export const SHADOW_V5_FILE = (seasonLabel: string) => `site/${seasonLabel}/shadow-v5.json`;
export const SHADOW_V5_LABEL = "In testing: model v5 (v4 plus an on-court observation). Not the published forecast.";

export const isV5Row = (row: LedgerRow): boolean => row.type !== "result" && row.modelVersion === V5_MODEL_VERSION;

const round = (value: number, digits: number) => Number(value.toFixed(digits));
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const V5_PARAMS_HASH = sha(JSON.stringify(V5_FROZEN)).slice(0, 16);

/**
 * The live season's plus/minus from the stored player lines: game id -> team id -> athlete id ->
 * plus/minus, for players with minutes above zero. ESPN's box-score "+/-" column, the same
 * column and sign (his team's points minus its opponent's while he was on the floor) as
 * the historical plus/minus files' box-score source. The engine applies the five-man check itself.
 */
export function livePlusMinus(days: Iterable<PlayerGamesDay>): Map<string, Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, Map<string, number>>>();
  for (const day of days) {
    for (const [gameId, game] of Object.entries(day.games)) {
      const teams = new Map<string, Map<string, number>>();
      for (const [teamId, entry] of Object.entries(game.teams)) {
        teams.set(teamId, new Map(entry.lines.filter((line) => line[2] > 0).map((line) => [line[0], line[17]] as [string, number])));
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

export type ShadowV5Input = {
  season: number;
  seasonLabel: string;
  slate: string;
  nowIso: string;
  runId: string;
  phase: SeasonPhase;
  observed?: ObservedPostseason;
  history: readonly SeasonGame[];
  seasonGames: readonly SeasonGame[];
  /** Every ledger row, v4's and v5's included. */
  ledger: readonly LedgerRow[];
  report: ReportInUse;
  source: AvailabilitySource;
  nameOf: (athleteId: string) => string | undefined;
  playerDays: Iterable<PlayerGamesDay>;
  marketFor: (gameId: string) => MarketReference | null;
  priorHomeWinRate: number;
  firstEtDate?: string | null;
  lastEtDate?: string | null;
  iterations?: number;
  /** Tests only: the state after 2025-26 (default: the committed warm checkpoint). */
  warmState?: () => RosterState;
};

export type ShadowV5Output = { seals: SealRow[]; missed: LedgerRow[]; shadow: ShadowV5File | null };

export function shadowV5(input: ShadowV5Input): ShadowV5Output {
  const first = input.firstEtDate === undefined ? V5_FIRST_ET_DATE : input.firstEtDate;
  const last = input.lastEtDate === undefined ? V5_LAST_ET_DATE : input.lastEtDate;
  if (!first || input.slate < first) return { seals: [], missed: [], shadow: null };
  const days = [...input.playerDays];
  const plusMinus = livePlusMinus(days);
  const params: V5RatingParams = withOnCourt(V4_FROZEN.ratings, {
    s3: V5_FROZEN.s3,
    plusMinus: (gameId, teamId) => plusMinus.get(gameId)?.get(teamId) ?? null,
  });
  // The stop switch: only games from the first to the last ET date, inclusive.
  const eligible = (decision: SealDecision) => inV5Range(decision.game.etDate, first, last);
  const decisions: Array<SealDecision & { kind: SealKind }> = [
    ...decideSeals(input.seasonGames, sealedGameIds(input.ledger, V5_MODEL_VERSION, "morning"), input.nowIso, "morning")
      .filter(eligible)
      .map((decision) => ({ ...decision, kind: "morning" as const })),
    ...(input.report.point
      ? decideReissues(input.seasonGames, input.ledger, input.nowIso, V5_MODEL_VERSION, input.slate)
          .filter(eligible)
          .map((decision) => ({ ...decision, kind: "reissued" as const }))
      : []),
    ...decideSeals(input.seasonGames, sealedGameIds(input.ledger, V5_MODEL_VERSION, "final"), input.nowIso, "final")
      .filter(eligible)
      .map((decision) => ({ ...decision, kind: "final" as const })),
  ];

  const lines = liveLines(days);
  const rosters = openingRosters(input.seasonGames, lines, input.season);
  const finals = input.seasonGames.filter((game) => game.status === "final");
  const reportFor = (game: SeasonGame): ReportPoint | null => input.source.availability(game.id)?.final ?? null;
  const state = (input.warmState ?? loadWarmStateV5)();
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
    // M5's scale for this date, as v4's live path refreshes it (registration-v4.md; Astra's review of PR #37).
    refreshScale(copy);
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
      modelVersion: V5_MODEL_VERSION,
      paramsHash: V5_PARAMS_HASH,
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
  // A game outside the range is never v5's to seal, so never v5's to miss.
  const missed = decideMissed(input.seasonGames, afterSeals, input.nowIso, V5_MODEL_VERSION).filter((row) =>
    inV5Range(row.etDate, first, last),
  );
  const all = [...afterSeals, ...missed];
  return { seals, missed, shadow: shadowFile(input, all, states.get(input.slate) as RosterState, params, first, last) };
}

type ScoreLine = { brier: number | null; logLoss: number | null };

/** Games with a scored seal from all four of v5, v4, v2 and v1, each on its own scored seal. */
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
  const versions = [V5_MODEL_VERSION, V4_MODEL_VERSION, LIVE_MODEL_VERSION, REFERENCE_MODEL_VERSION];
  const games = [...(seals.get(V5_MODEL_VERSION)?.keys() ?? [])].filter(
    (id) => results.has(id) && versions.every((version) => seals.get(version)?.has(id)),
  );
  const score = (version: string): ScoreLine => {
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
  return {
    games: games.length,
    v5: score(V5_MODEL_VERSION),
    v4: score(V4_MODEL_VERSION),
    v2: score(LIVE_MODEL_VERSION),
    v1: score(REFERENCE_MODEL_VERSION),
  };
}

export type ShadowV5File = ReturnType<typeof shadowFile>;

function shadowFile(input: ShadowV5Input, ledger: readonly LedgerRow[], slateState: RosterState, params: V5RatingParams, first: string, last: string | null) {
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
  // Season odds use v4's simulator input unchanged, on v5's state (registration-v5.md, "Code").
  const { input: v4Input, players } = buildV4Season(state, input.season, teamIds, {
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
    v4: v4Input,
  });
  return {
    version: 1 as const,
    modelVersion: V5_MODEL_VERSION,
    label: SHADOW_V5_LABEL,
    firstEtDate: first,
    /** The stop switch's last ET date, or null while v5 keeps sealing. */
    lastEtDate: last,
    s3: V5_FROZEN.s3,
    slate: input.slate,
    record: summarizeRecord(ledger, V5_MODEL_VERSION, input.priorHomeWinRate, { finalSeals: true }),
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
    /** Kept in v4's shape (W5); no page reads it, and src/lib/view/impact-source.ts is unchanged. */
    impact: Object.fromEntries(players.map((player) => [player.athleteId, round(player.points, 3)])),
  };
}
