// Pure core of the live pipeline: sealing rules, the standings cross-check and
// the public record. No fetch and no file access, so every rule can be tested with
// a frozen clock and replayed over past seasons.

import { addDays, etDateOf, etHourOf } from "@/lib/season/dates";
import { clampProbability } from "@/lib/season/math";
import { REFERENCE_MODEL_VERSION } from "@/lib/season/params";
import { POLICY_MODEL_VERSION, POLICY_REVISIONS, sealPolicyRevision } from "@/lib/season/policy-revisions";
import {
  isBackToBack,
  paramsHash,
  predictGame,
  ratingsHash,
  replayRatings,
  toRatingState,
} from "@/lib/season/ratings";
import { buildStandings } from "@/lib/season/standings";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type {
  LedgerRow,
  MarketReference,
  MissedRow,
  ModelParams,
  RecordSummary,
  ResultRow,
  SealKind,
  SealRow,
  SeasonGame,
} from "@/lib/season/types";

/** Slates roll at 06:00 ET, so a late West Coast game stays on its own day. */
const SLATE_ROLL_HOUR = 6;
const SEAL_FALLBACK_MS = 6 * 3_600_000;
/** A final seal is written by the first run inside this many milliseconds before tip. */
export const FINAL_SEAL_WINDOW_MS = 60 * 60_000;
/** A game this many days old stops blocking seals. */
const STUCK_AFTER_DAYS = 3;
const SMALL_SAMPLE_GAMES = 500;
/**
 * A quiet run still republishes after this long. Nothing changes between a morning
 * seal and the first final of the night, and freshness is judged from `generatedAt`,
 * so without this a healthy job would look stale every evening.
 */
export const STATE_REFRESH_HOURS = 2;

export function slateDateAt(now: string | number | Date): string {
  const time = new Date(now).getTime();
  return etDateOf(time - SLATE_ROLL_HOUR * 3_600_000);
}

function isUnresolved(game: SeasonGame): boolean {
  return game.status === "scheduled" || game.status === "in-progress";
}

/** Games from before `etDate` that should be final but are not. */
export function blockingGames(games: readonly SeasonGame[], etDate: string): SeasonGame[] {
  const stuckBefore = addDays(etDate, -STUCK_AFTER_DAYS);
  return games.filter(
    (game) => game.etDate < etDate && game.etDate > stuckBefore && isUnresolved(game),
  );
}

/** Old unfinished games: excluded from blocking, flagged for a human. */
export function stuckGames(games: readonly SeasonGame[], etDate: string): SeasonGame[] {
  const stuckBefore = addDays(etDate, -STUCK_AFTER_DAYS);
  return games.filter((game) => game.etDate <= stuckBefore && isUnresolved(game));
}

function sealWindowOpen(etDate: string, now: Date): boolean {
  const today = etDateOf(now);
  if (today > etDate) return true;
  return today === etDate && etHourOf(now) >= SLATE_ROLL_HOUR;
}

export type SealDecision = {
  game: SeasonGame;
  inputsIncomplete: boolean;
  missingGameIds: string[];
};

/** v1 rows carry no kind: one seal per game, written in the morning. */
export function sealKindOf(row: SealRow): SealKind {
  return row.sealKind ?? "morning";
}

/** Rows written before v2 carry no version and all belong to v1. */
export function missedVersionOf(row: MissedRow): string {
  return row.modelVersion ?? REFERENCE_MODEL_VERSION;
}

/** Games that already have a seal of this version and kind. Seals key on all three. */
export function sealedGameIds(
  ledger: readonly LedgerRow[],
  modelVersion: string,
  kind: SealKind,
): Set<string> {
  return new Set(
    ledger
      .filter(
        (row): row is SealRow =>
          row.type === "seal" && row.modelVersion === modelVersion && sealKindOf(row) === kind,
      )
      .map((row) => row.gameId),
  );
}

/**
 * Which games a run should seal now. `sealedIds` holds the games already sealed for
 * the same model version and kind.
 *
 * Morning: a game is sealed when the seal window for its date is open and every
 * earlier game is resolved, or when its tip is within six hours regardless, in which
 * case the row says its inputs were incomplete.
 *
 * Final: the first run with `0 < tip - now <= 60 minutes`, from the same frozen
 * ratings, marked incomplete if an earlier game is still unresolved.
 */
export function decideSeals(
  games: readonly SeasonGame[],
  sealedIds: ReadonlySet<string>,
  nowIso: string,
  kind: SealKind = "morning",
): SealDecision[] {
  const now = new Date(nowIso);
  const decisions: SealDecision[] = [];
  for (const game of games) {
    if (game.status !== "scheduled" || sealedIds.has(game.id)) continue;
    const tip = Date.parse(game.tipUtc);
    if (tip <= now.getTime()) continue;
    const blocking = blockingGames(games, game.etDate);
    if (kind === "final") {
      if (tip - now.getTime() > FINAL_SEAL_WINDOW_MS) continue;
      decisions.push({
        game,
        inputsIncomplete: blocking.length > 0,
        missingGameIds: blocking.map((row) => row.id),
      });
    } else if (sealWindowOpen(game.etDate, now) && blocking.length === 0) {
      decisions.push({ game, inputsIncomplete: false, missingGameIds: [] });
    } else if (tip - now.getTime() <= SEAL_FALLBACK_MS) {
      decisions.push({
        game,
        inputsIncomplete: blocking.length > 0,
        missingGameIds: blocking.map((row) => row.id),
      });
    }
  }
  return decisions;
}

/**
 * Morning seals to reissue. A morning seal written with no injury report priced every
 * absence at zero, so the first run holding a usable report seals the game again, once,
 * under its true issue time. The original row stays in the ledger. A game within the final
 * seal's window is left to the final seal, and only `slate`'s games qualify because the
 * report in use is cut to that slate. Callers pass this only when a report is in use.
 */
export function decideReissues(
  games: readonly SeasonGame[],
  ledger: readonly LedgerRow[],
  nowIso: string,
  modelVersion: string,
  slate: string,
): SealDecision[] {
  const now = Date.parse(nowIso);
  const lacking = new Set(
    ledger
      .filter(
        (row): row is SealRow =>
          row.type === "seal" &&
          row.modelVersion === modelVersion &&
          sealKindOf(row) === "morning" &&
          row.availabilityMissing === true,
      )
      .map((row) => row.gameId),
  );
  const reissued = sealedGameIds(ledger, modelVersion, "reissued");
  const finals = sealedGameIds(ledger, modelVersion, "final");
  const decisions: SealDecision[] = [];
  for (const game of games) {
    if (!lacking.has(game.id) || reissued.has(game.id) || finals.has(game.id)) continue;
    if (game.status !== "scheduled" || game.etDate !== slate) continue;
    if (Date.parse(game.tipUtc) - now <= FINAL_SEAL_WINDOW_MS) continue;
    const blocking = blockingGames(games, game.etDate);
    decisions.push({
      game,
      inputsIncomplete: blocking.length > 0,
      missingGameIds: blocking.map((row) => row.id),
    });
  }
  return decisions;
}

/** Whether to write new state. A run with nothing new only refreshes the timestamp. */
export function shouldPublishState(input: {
  /** Null when no state has been published yet. */
  previousGeneratedAt: string | null;
  contentChanged: boolean;
  nowIso: string;
}): boolean {
  if (input.previousGeneratedAt === null || input.contentChanged) return true;
  const ageHours =
    (Date.parse(input.nowIso) - Date.parse(input.previousGeneratedAt)) / 3_600_000;
  return ageHours >= STATE_REFRESH_HOURS;
}

/**
 * The stored form of a game. Live scores never leave the run that fetched them: they
 * have no use in stored data, and they would make every run during a game a new commit.
 */
export function withoutLiveScores(game: SeasonGame): SeasonGame {
  return game.status === "in-progress" ? { ...game, homeScore: null, awayScore: null } : game;
}

/** ET dates each team plays in a window around `etDate`, from the schedule. */
export function teamGameDatesAround(
  games: readonly SeasonGame[],
  etDate: string,
  days = 3,
): Record<string, string[]> {
  const first = addDays(etDate, -days);
  const last = addDays(etDate, days);
  const output: Record<string, Set<string>> = {};
  for (const team of SEASON_TEAMS) output[team.id] = new Set();
  for (const game of games) {
    if (game.status === "postponed" || game.status === "canceled") continue;
    if (game.etDate < first || game.etDate > last) continue;
    output[game.homeId].add(game.etDate);
    output[game.awayId].add(game.etDate);
  }
  return Object.fromEntries(
    Object.entries(output).map(([id, dates]) => [id, [...dates].sort()]),
  );
}

/** Back-to-back comes from the schedule, not finals, so a late final cannot hide it. */
export function backToBackFromDates(dates: readonly string[], etDate: string): boolean {
  let last: string | null = null;
  for (const date of dates) {
    if (date < etDate && (last === null || date > last)) last = date;
  }
  return isBackToBack(last, etDate);
}

export type SealContext = {
  history: readonly SeasonGame[];
  seasonGames: readonly SeasonGame[];
  params: ModelParams;
  modelVersion: string;
  runId: string;
  nowIso: string;
  marketFor: (gameId: string) => MarketReference | null;
};

/**
 * Prices each decision from ratings frozen at the end of the previous ET date, so
 * same-day results can never change a later game's sealed number.
 */
export function sealGames(decisions: readonly SealDecision[], context: SealContext): SealRow[] {
  const rows: SealRow[] = [];
  const replayByDate = new Map<string, ReturnType<typeof replayRatings>>();
  const allGames = [...context.history, ...context.seasonGames];
  for (const decision of decisions) {
    const { game } = decision;
    let replay = replayByDate.get(game.etDate);
    if (!replay) {
      replay = replayRatings(allGames, context.params, {
        isIncluded: (row) => row.etDate < game.etDate,
        asOfEtDate: game.etDate,
      });
      replayByDate.set(game.etDate, replay);
    }
    const dates = teamGameDatesAround(context.seasonGames, game.etDate);
    const prediction = predictGame(
      replay.state,
      {
        homeId: game.homeId,
        awayId: game.awayId,
        neutral: game.neutral,
        playoff: game.kind === "playoff",
        homeOnBackToBack: backToBackFromDates(dates[game.homeId], game.etDate),
        awayOnBackToBack: backToBackFromDates(dates[game.awayId], game.etDate),
      },
      context.params,
    );
    rows.push({
      type: "seal",
      gameId: game.id,
      etDate: game.etDate,
      tipUtc: game.tipUtc,
      issuedAt: context.nowIso,
      modelVersion: context.modelVersion,
      paramsHash: paramsHash(context.params),
      ratingsHash: ratingsHash(toRatingState(replay.state)),
      homeId: game.homeId,
      awayId: game.awayId,
      homeWinProbability: Number(prediction.homeWinProbability.toFixed(6)),
      expectedMargin: Number(prediction.expectedMargin.toFixed(4)),
      inputsIncomplete: decision.inputsIncomplete,
      missingGameIds: decision.missingGameIds,
      runId: context.runId,
      market: context.marketFor(game.id),
    });
  }
  return rows;
}

/**
 * Games that tipped without any seal from this model version, once that version has
 * sealed something. Games from before its first seal predate its record and are not
 * misses. A v2 game with a morning seal but no final seal is not missed: it is scored on
 * the morning seal and counted as "no final seal".
 */
export function decideMissed(
  games: readonly SeasonGame[],
  ledger: readonly LedgerRow[],
  nowIso: string,
  modelVersion: string,
): MissedRow[] {
  const seals = ledger.filter(
    (row): row is SealRow => row.type === "seal" && row.modelVersion === modelVersion,
  );
  if (seals.length === 0) return [];
  const started = seals.reduce(
    (earliest, row) => Math.min(earliest, Date.parse(row.issuedAt)),
    Number.POSITIVE_INFINITY,
  );
  const known = new Set(seals.map((row) => row.gameId));
  for (const row of ledger) {
    if (row.type === "missed" && missedVersionOf(row) === modelVersion) known.add(row.gameId);
  }
  const now = Date.parse(nowIso);
  const rows: MissedRow[] = [];
  for (const game of games) {
    if (known.has(game.id)) continue;
    if (game.status === "postponed" || game.status === "canceled") continue;
    const tip = Date.parse(game.tipUtc);
    if (tip <= started || tip > now) continue;
    rows.push({
      type: "missed",
      gameId: game.id,
      etDate: game.etDate,
      tipUtc: game.tipUtc,
      homeId: game.homeId,
      awayId: game.awayId,
      recordedAt: nowIso,
      modelVersion,
    });
  }
  return rows;
}

/** Results for ledger games. A later corrected score appends a new row. */
export function decideResults(
  games: readonly SeasonGame[],
  ledger: readonly LedgerRow[],
  nowIso: string,
): ResultRow[] {
  const tracked = new Set(
    ledger.filter((row) => row.type !== "result").map((row) => row.gameId),
  );
  const latest = new Map<string, ResultRow>();
  for (const row of ledger) if (row.type === "result") latest.set(row.gameId, row);
  const rows: ResultRow[] = [];
  for (const game of games) {
    if (!tracked.has(game.id) || game.status !== "final") continue;
    if (game.homeScore === null || game.awayScore === null) continue;
    const previous = latest.get(game.id);
    if (
      previous &&
      previous.homeScore === game.homeScore &&
      previous.awayScore === game.awayScore
    ) {
      continue;
    }
    rows.push({
      type: "result",
      gameId: game.id,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      recordedAt: nowIso,
    });
  }
  return rows;
}

/** A game's standing morning number: the reissued seal when one exists. Rows of one version. */
export function morningSeal(rows: readonly SealRow[]): SealRow | null {
  return (
    rows.find((row) => sealKindOf(row) === "reissued") ??
    rows.find((row) => sealKindOf(row) === "morning") ??
    null
  );
}

/**
 * The seal a game is scored on: its final seal when one exists, else its morning seal,
 * as reissued if it was. Input rows must all belong to one game and one version.
 */
export function scoredSeal(rows: readonly SealRow[]): SealRow | null {
  return rows.find((row) => sealKindOf(row) === "final") ?? morningSeal(rows);
}

/** Seal rows by game ID, in ledger order, for games on ET dates in `[first, last]`. */
export function sealsByGame(
  ledger: readonly LedgerRow[],
  first: string,
  last: string,
): Record<string, SealRow[]> {
  const output: Record<string, SealRow[]> = {};
  for (const row of ledger) {
    if (row.type !== "seal" || row.etDate < first || row.etDate > last) continue;
    (output[row.gameId] ??= []).push(row);
  }
  return output;
}

/**
 * Scores sealed forecasts for one model version. Each game is scored once, on its
 * final seal if it has one, else its reissued seal, else its original morning seal; a
 * version that writes final seals also counts the scored games that never got one, and
 * scores its pre-final seals separately: original morning, reissued, and the latest of
 * the two. For v2 it also splits the record by policy revision, descriptively.
 */
export function summarizeRecord(
  ledger: readonly LedgerRow[],
  modelVersion: string,
  priorHomeWinRate: number,
  /** Whether this version writes final seals. Read from its rows when not given. */
  options: { finalSeals?: boolean } = {},
): RecordSummary {
  const byGame = new Map<string, SealRow[]>();
  let twoSeals = options.finalSeals ?? false;
  for (const row of ledger) {
    if (row.type !== "seal" || row.modelVersion !== modelVersion) continue;
    if (row.sealKind !== undefined && options.finalSeals === undefined) twoSeals = true;
    const rows = byGame.get(row.gameId) ?? [];
    rows.push(row);
    byGame.set(row.gameId, rows);
  }
  const results = new Map<string, ResultRow>();
  for (const row of ledger) if (row.type === "result") results.set(row.gameId, row);
  let scored = 0;
  let brierSum = 0;
  let logLossSum = 0;
  let correct = 0;
  let baselineSum = 0;
  let latestSum = 0;
  let latestCount = 0;
  let originalSum = 0;
  let originalCount = 0;
  let reissuedSum = 0;
  let reissuedCount = 0;
  const revisions = new Map(POLICY_REVISIONS.map((row) => [row.revision, { sealRows: 0, sealed: 0, scored: 0, sum: 0 }]));
  if (modelVersion === POLICY_MODEL_VERSION) {
    for (const rows of byGame.values()) {
      for (const row of rows) {
        const entry = revisions.get(sealPolicyRevision(row)!);
        if (entry) entry.sealRows += 1;
      }
    }
  }
  let noFinalSeal = 0;
  let incomplete = 0;
  let referenceSum = 0;
  let referenceCount = 0;
  let referenceModelVersion: string | null = null;
  for (const rows of byGame.values()) {
    const seal = scoredSeal(rows);
    if (!seal) continue;
    if (seal.inputsIncomplete) incomplete += 1;
    const revision = modelVersion === POLICY_MODEL_VERSION ? revisions.get(sealPolicyRevision(seal)!) : undefined;
    if (revision) revision.sealed += 1;
    const result = results.get(seal.gameId);
    if (!result) continue;
    const homeWon = result.homeScore > result.awayScore ? 1 : 0;
    const p = clampProbability(seal.homeWinProbability);
    scored += 1;
    brierSum += (p - homeWon) ** 2;
    if (revision) {
      revision.scored += 1;
      revision.sum += (p - homeWon) ** 2;
    }
    logLossSum -= homeWon * Math.log(p) + (1 - homeWon) * Math.log(1 - p);
    if ((p > 0.5) === (homeWon === 1)) correct += 1;
    baselineSum += (priorHomeWinRate - homeWon) ** 2;
    if (seal.referenceHomeWinProbability !== undefined) {
      referenceSum += (clampProbability(seal.referenceHomeWinProbability) - homeWon) ** 2;
      referenceCount += 1;
      referenceModelVersion ??= seal.referenceModelVersion ?? null;
    }
    if (twoSeals) {
      if (sealKindOf(seal) !== "final") noFinalSeal += 1;
      const latest = morningSeal(rows);
      if (latest) {
        latestSum += (clampProbability(latest.homeWinProbability) - homeWon) ** 2;
        latestCount += 1;
      }
      const original = rows.find((row) => sealKindOf(row) === "morning");
      if (original) {
        originalSum += (clampProbability(original.homeWinProbability) - homeWon) ** 2;
        originalCount += 1;
      }
      const reissued = rows.find((row) => sealKindOf(row) === "reissued");
      if (reissued) {
        reissuedSum += (clampProbability(reissued.homeWinProbability) - homeWon) ** 2;
        reissuedCount += 1;
      }
    }
  }
  return {
    modelVersion,
    sealed: byGame.size,
    scored,
    pending: byGame.size - scored,
    missed: ledger.filter((row) => row.type === "missed" && missedVersionOf(row) === modelVersion)
      .length,
    incomplete,
    noFinalSeal: twoSeals ? noFinalSeal : null,
    brier: scored ? brierSum / scored : null,
    logLoss: scored ? logLossSum / scored : null,
    accuracy: scored ? correct / scored : null,
    baselineBrier: scored ? baselineSum / scored : null,
    morningBrier: twoSeals && latestCount ? latestSum / latestCount : null,
    ...(twoSeals
      ? {
          originalMorningBrier: originalCount ? originalSum / originalCount : null,
          originalMorningCount: originalCount,
          reissuedBrier: reissuedCount ? reissuedSum / reissuedCount : null,
          reissuedCount,
          latestPreFinalBrier: latestCount ? latestSum / latestCount : null,
          latestPreFinalCount: latestCount,
        }
      : {}),
    ...(modelVersion === POLICY_MODEL_VERSION
      ? {
          policyRevisions: [...revisions.entries()].map(([revision, row]) => ({
            revision,
            sealRows: row.sealRows,
            sealed: row.sealed,
            scored: row.scored,
            brier: row.scored ? row.sum / row.scored : null,
          })),
        }
      : {}),
    // Only when every scored game carries a reference, so the comparison is paired.
    referenceBrier: referenceCount > 0 && referenceCount === scored ? referenceSum / referenceCount : null,
    referenceModelVersion: referenceCount > 0 ? referenceModelVersion : null,
    smallSample: scored < SMALL_SAMPLE_GAMES,
  };
}

// ---------------------------------------------------------------------------
// Standings cross-check
// ---------------------------------------------------------------------------

export type EspnStanding = {
  teamId: string;
  wins: number;
  losses: number;
};

export type CrossCheckResult = {
  failures: string[];
  lagNotes: string[];
};

/**
 * Stateless check of our record against ESPN's. Standings must be fetched BEFORE
 * results, so that ESPN can only trail ours because of timing, not the reverse.
 * Gaps are forgiven only for games dated D-1 or D, so a game one side never counts
 * cannot pass as lag forever.
 */
export function crossCheckStandings(
  espn: readonly EspnStanding[],
  games: readonly SeasonGame[],
  etDate: string,
): CrossCheckResult {
  const table = buildStandings(games);
  const previous = addDays(etDate, -1);
  const inWindow = (game: SeasonGame) => game.etDate === etDate || game.etDate === previous;
  const failures: string[] = [];
  const lagNotes: string[] = [];
  SEASON_TEAMS.forEach((team, index) => {
    const row = espn.find((entry) => entry.teamId === team.id);
    if (!row) {
      failures.push(`${team.abbreviation}: missing from ESPN standings`);
      return;
    }
    const ourWins = table.wins[index];
    const ourPlayed = ourWins + table.losses[index];
    const espnPlayed = row.wins + row.losses;
    const teamGames = games.filter(
      (game) =>
        game.kind === "regular" && (game.homeId === team.id || game.awayId === team.id),
    );
    if (espnPlayed === ourPlayed) {
      if (row.wins !== ourWins) {
        failures.push(
          `${team.abbreviation}: same games played, ESPN ${row.wins}-${row.losses}, ours ${ourWins}-${table.losses[index]}`,
        );
      }
      return;
    }
    if (espnPlayed < ourPlayed) {
      const allowed = teamGames.filter(
        (game) => game.status === "final" && inWindow(game),
      ).length;
      const gap = ourPlayed - espnPlayed;
      const winsGap = ourWins - row.wins;
      if (gap <= allowed && winsGap >= 0 && winsGap <= allowed) {
        lagNotes.push(`${team.abbreviation}: ESPN standings trail by ${gap}`);
      } else {
        failures.push(
          `${team.abbreviation}: ESPN has ${espnPlayed} games, ours ${ourPlayed}, beyond the recent window`,
        );
      }
      return;
    }
    const allowed = teamGames.filter(
      (game) => isUnresolved(game) && inWindow(game),
    ).length;
    const gap = espnPlayed - ourPlayed;
    if (gap <= allowed) {
      lagNotes.push(`${team.abbreviation}: our results trail ESPN by ${gap}`);
    } else {
      failures.push(
        `${team.abbreviation}: ESPN has ${espnPlayed} games, ours ${ourPlayed}, beyond the recent window`,
      );
    }
  });
  return { failures, lagNotes };
}
