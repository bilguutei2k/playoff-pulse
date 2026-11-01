// Pure core of the live pipeline: sealing rules, the standings cross-check and
// the public record. No fetch and no file access, so every rule can be tested with
// a frozen clock and replayed over past seasons.

import { addDays, etDateOf, etHourOf } from "@/lib/season/dates";
import { clampProbability } from "@/lib/season/math";
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
  SealRow,
  SeasonGame,
} from "@/lib/season/types";

/** Slates roll at 06:00 ET, so a late West Coast game stays on its own day. */
const SLATE_ROLL_HOUR = 6;
const SEAL_FALLBACK_MS = 6 * 3_600_000;
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

/**
 * Which games a run should seal now. A game is sealed when the seal window for its
 * date is open and every earlier game is resolved, or when its tip is within six
 * hours regardless, in which case the row says its inputs were incomplete.
 */
export function decideSeals(
  games: readonly SeasonGame[],
  sealedIds: ReadonlySet<string>,
  nowIso: string,
): SealDecision[] {
  const now = new Date(nowIso);
  const decisions: SealDecision[] = [];
  for (const game of games) {
    if (game.status !== "scheduled" || sealedIds.has(game.id)) continue;
    const tip = Date.parse(game.tipUtc);
    if (tip <= now.getTime()) continue;
    const blocking = blockingGames(games, game.etDate);
    if (sealWindowOpen(game.etDate, now) && blocking.length === 0) {
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
 * Games that tipped without a seal, once the ledger exists. Games from before the
 * first seal predate the record and are not misses.
 */
export function decideMissed(
  games: readonly SeasonGame[],
  ledger: readonly LedgerRow[],
  nowIso: string,
): MissedRow[] {
  const seals = ledger.filter((row): row is SealRow => row.type === "seal");
  if (seals.length === 0) return [];
  const started = seals.reduce(
    (earliest, row) => Math.min(earliest, Date.parse(row.issuedAt)),
    Number.POSITIVE_INFINITY,
  );
  const known = new Set(
    ledger.filter((row) => row.type !== "result").map((row) => row.gameId),
  );
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

/** Scores sealed forecasts for one model version. */
export function summarizeRecord(
  ledger: readonly LedgerRow[],
  modelVersion: string,
  priorHomeWinRate: number,
): RecordSummary {
  const seals = ledger.filter(
    (row): row is SealRow => row.type === "seal" && row.modelVersion === modelVersion,
  );
  const results = new Map<string, ResultRow>();
  for (const row of ledger) if (row.type === "result") results.set(row.gameId, row);
  let scored = 0;
  let brierSum = 0;
  let logLossSum = 0;
  let correct = 0;
  let baselineSum = 0;
  for (const seal of seals) {
    const result = results.get(seal.gameId);
    if (!result) continue;
    const homeWon = result.homeScore > result.awayScore ? 1 : 0;
    const p = clampProbability(seal.homeWinProbability);
    scored += 1;
    brierSum += (p - homeWon) ** 2;
    logLossSum -= homeWon * Math.log(p) + (1 - homeWon) * Math.log(1 - p);
    if ((p > 0.5) === (homeWon === 1)) correct += 1;
    baselineSum += (priorHomeWinRate - homeWon) ** 2;
  }
  return {
    modelVersion,
    sealed: seals.length,
    scored,
    pending: seals.length - scored,
    missed: ledger.filter((row) => row.type === "missed").length,
    incomplete: seals.filter((row) => row.inputsIncomplete).length,
    brier: scored ? brierSum / scored : null,
    logLoss: scored ? logLossSum / scored : null,
    accuracy: scored ? correct / scored : null,
    baselineBrier: scored ? baselineSum / scored : null,
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
