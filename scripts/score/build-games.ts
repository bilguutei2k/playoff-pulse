// Builds the 548 score's game records from the stored ESPN summaries: full box lines, and
// stints rebuilt from the play-by-play and audited against the box score. Writes each
// season to data/historical/raw/score/games/{season}.json.gz (ignored by Git) and the
// per-season audit to docs/score/lineup-audit.json, merging seasons already in the file.
//
// Run: corepack pnpm exec tsx scripts/score/build-games.ts 2026 2025 ...

import * as fs from "node:fs";
import * as path from "node:path";
import { parsePlays, parseScoreSummary, type ScoreSummary } from "../../src/lib/live-data/espn-plays";
import { REJECTION_RULE, rebuildGame, type GameRebuild, type PeriodStartCounts } from "../../src/lib/score/lineups";
import type { ScoreGame } from "../../src/lib/score/types";
import type { PlayerBoxLine } from "../../src/lib/season/player-stats";
import { compareGames, loadSeasonGames } from "../live/game-store";
import { loadSummary, saveScoreGames } from "./store";

const AUDIT_FILE = path.join(process.cwd(), "docs", "score", "lineup-audit.json");

type SeasonAudit = {
  /** Final regular-season games in the season's game list. */
  gamesListed: number;
  /** Of those, games written to the games file: a stored summary with a usable box score. */
  gamesStored: number;
  /** Listed games with no stored summary, and stored summaries whose box score did not parse. */
  missingSummaries: number;
  unparseableBox: number;
  /**
   * Summaries whose box score is empty for a team (every player "--" minutes and zeros; ESPN
   * has this in about 13% of games from 2012-13 to 2017-18). Not stored: zero lines would
   * read as real games, and the stints cannot be audited.
   */
  emptyBox: number;
  gamesWithStints: number;
  shareWithStints: number;
  /** Rejected games by the rule that rejected them. */
  rejected: Record<string, number>;
  /** Accepted games by how later periods' opening fives were known. */
  source: Record<string, number>;
  /** Stored games with at least one period-start substitution logged. */
  gamesLoggingPeriodStarts: number;
  /** Team-periods after the first, by how their opening five was found (accepted games). */
  periodStarts: PeriodStartCounts;
  /** Player lines of accepted games by |stint plus-minus − box plus-minus|. */
  plusMinus: { players: number; exact: number; withinOne: number; beyond: number };
  /** The same over every stored game, rejected ones included (closest assignment). */
  plusMinusAllGames: { players: number; exact: number; withinOne: number; beyond: number };
  /** Stint possessions over FGA − ORB + TOV + 0.44 × FTA, per team-game of accepted games. */
  possessions: { teamGames: number; meanRatio: number; sdRatio: number; p05: number; p95: number };
  stintsPerGame: { mean: number; min: number; max: number };
  /** Accepted games with a play naming a player the rebuilt lineup has on the bench. */
  gamesWithOffFloorActions: number;
  /** Games whose header score differs from the game list's. */
  scoreMismatches: number;
};

type AuditFile = {
  description: string;
  rule: typeof REJECTION_RULE;
  seasons: Record<string, SeasonAudit>;
};

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

function reasonKey(reason: string): string {
  return reason.split(":")[0];
}

function boxPossessions(lines: readonly PlayerBoxLine[], totalTurnovers: number | null): number {
  let fga = 0;
  let fta = 0;
  let orb = 0;
  let tov = 0;
  for (const line of lines) {
    fga += line.fieldGoalsAttempted;
    fta += line.freeThrowsAttempted;
    orb += line.offensiveRebounds;
    tov += line.turnovers;
  }
  // ESPN's team total includes team turnovers, but in some seasons (2017-18) it is plainly
  // wrong (0 to 2 a game), so it is used only when it is at least the players' sum.
  return fga - orb + Math.max(totalTurnovers ?? 0, tov) + 0.44 * fta;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index];
}

function buildSeason(season: number): { games: ScoreGame[]; audit: SeasonAudit } {
  const listed = loadSeasonGames(season)
    .filter((game) => game.status === "final" && game.kind === "regular")
    .sort(compareGames);
  const games: ScoreGame[] = [];
  const rejected: Record<string, number> = {};
  const source: Record<string, number> = {};
  const periodStarts: PeriodStartCounts = {
    substitutions: 0,
    inferred: 0,
    silentFill: 0,
    fromBox: 0,
    carryOverContradicted: 0,
  };
  const pm = { players: 0, exact: 0, withinOne: 0, beyond: 0 };
  const pmAll = { players: 0, exact: 0, withinOne: 0, beyond: 0 };
  const ratios: number[] = [];
  const stintCounts: number[] = [];
  let missingSummaries = 0;
  let unparseableBox = 0;
  let emptyBox = 0;
  let loggingPeriodStarts = 0;
  let offFloorGames = 0;
  let scoreMismatches = 0;

  for (const game of listed) {
    const payload = loadSummary(season, game.id);
    if (payload === null) {
      missingSummaries += 1;
      continue;
    }
    let summary: ScoreSummary;
    try {
      summary = parseScoreSummary(payload, game.id);
    } catch (error) {
      unparseableBox += 1;
      console.warn(`[build] ${season} ${game.id}: box score skipped: ${(error as Error).message}`);
      continue;
    }
    if (summary.homeId !== game.homeId || summary.awayId !== game.awayId) {
      unparseableBox += 1;
      console.warn(`[build] ${season} ${game.id}: summary teams differ from the game list; skipped.`);
      continue;
    }
    if ([game.homeId, game.awayId].some((teamId) => summary.box[teamId].lines.every((line) => line.minutes === 0))) {
      emptyBox += 1;
      continue;
    }
    const homeScore = game.homeScore ?? summary.homeScore;
    const awayScore = game.awayScore ?? summary.awayScore;
    if (homeScore !== summary.homeScore || awayScore !== summary.awayScore) scoreMismatches += 1;

    const box: Record<string, PlayerBoxLine[]> = {
      [game.homeId]: summary.box[game.homeId].lines,
      [game.awayId]: summary.box[game.awayId].lines,
    };
    const inactive: Record<string, string[]> = {
      [game.homeId]: summary.box[game.homeId].didNotPlay.map((row) => row.athleteId),
      [game.awayId]: summary.box[game.awayId].didNotPlay.map((row) => row.athleteId),
    };
    const roster = new Map<string, string>();
    for (const teamId of [game.homeId, game.awayId]) {
      for (const line of box[teamId]) roster.set(line.athleteId, teamId);
      for (const athleteId of inactive[teamId]) roster.set(athleteId, teamId);
    }

    let rebuild: GameRebuild;
    try {
      const events = parsePlays(payload, game.id, game.homeId, game.awayId, roster);
      if (events.some((event) => event.kind === "substitution" && event.period >= 2 && event.clock === (event.period <= 4 ? 720 : 300))) {
        loggingPeriodStarts += 1;
      }
      rebuild = rebuildGame({ homeId: game.homeId, awayId: game.awayId, homeScore, awayScore, box, inactive, events });
    } catch (error) {
      const reason = `plays: ${(error as Error).message}`;
      rebuild = {
        stints: null,
        audit: {
          source: "inferred",
          wrongCountPlays: 0,
          maxPlusMinusGap: 0,
          plusMinusMisses: 0,
          maxMinutesGap: 0,
          homePointsGap: 0,
          awayPointsGap: 0,
          rejected: reason,
        },
        diagnostics: {
          plusMinusGaps: [],
          playerGaps: [],
          possessions: {},
          offFloorActions: 0,
          firstWrongCount: null,
          periodStarts: { substitutions: 0, inferred: 0, silentFill: 0, fromBox: 0, carryOverContradicted: 0 },
          assignmentsTried: 0,
          assignmentsReconciled: 0,
        },
      };
    }

    games.push({
      gameId: game.id,
      season,
      etDate: game.etDate,
      homeId: game.homeId,
      awayId: game.awayId,
      homeScore,
      awayScore,
      box,
      stints: rebuild.stints,
      audit: rebuild.audit,
    });

    for (const gap of rebuild.diagnostics.plusMinusGaps) {
      pmAll.players += 1;
      if (gap === 0) pmAll.exact += 1;
      else if (gap <= 1) pmAll.withinOne += 1;
      else pmAll.beyond += 1;
    }
    if (rebuild.audit.rejected !== null || rebuild.stints === null) {
      const key = reasonKey(rebuild.audit.rejected ?? "unknown");
      rejected[key] = (rejected[key] ?? 0) + 1;
      continue;
    }
    source[rebuild.audit.source] = (source[rebuild.audit.source] ?? 0) + 1;
    for (const key of Object.keys(periodStarts) as Array<keyof PeriodStartCounts>) {
      periodStarts[key] += rebuild.diagnostics.periodStarts[key];
    }
    for (const gap of rebuild.diagnostics.plusMinusGaps) {
      pm.players += 1;
      if (gap === 0) pm.exact += 1;
      else if (gap <= 1) pm.withinOne += 1;
      else pm.beyond += 1;
    }
    for (const teamId of [game.homeId, game.awayId]) {
      const estimate = boxPossessions(box[teamId], summary.teamTotals[teamId]?.totalTurnovers ?? null);
      const counted = rebuild.diagnostics.possessions[teamId] ?? 0;
      if (estimate > 0) ratios.push(counted / estimate);
    }
    stintCounts.push(rebuild.stints.length);
    if (rebuild.diagnostics.offFloorActions > 0) offFloorGames += 1;
  }

  const withStints = stintCounts.length;
  const meanRatio = ratios.reduce((sum, value) => sum + value, 0) / Math.max(1, ratios.length);
  const sdRatio = Math.sqrt(
    ratios.reduce((sum, value) => sum + (value - meanRatio) ** 2, 0) / Math.max(1, ratios.length - 1),
  );
  const sortedRatios = [...ratios].sort((a, b) => a - b);
  const share = (part: number, whole: number) => round(part / Math.max(1, whole), 4);
  const audit: SeasonAudit = {
    gamesListed: listed.length,
    gamesStored: games.length,
    missingSummaries,
    unparseableBox,
    emptyBox,
    gamesWithStints: withStints,
    shareWithStints: share(withStints, games.length),
    rejected: Object.fromEntries(Object.entries(rejected).sort((a, b) => b[1] - a[1])),
    source,
    gamesLoggingPeriodStarts: loggingPeriodStarts,
    periodStarts,
    plusMinus: pm,
    plusMinusAllGames: pmAll,
    possessions: {
      teamGames: ratios.length,
      meanRatio: round(meanRatio, 4),
      sdRatio: round(sdRatio, 4),
      p05: round(quantile(sortedRatios, 0.05), 4),
      p95: round(quantile(sortedRatios, 0.95), 4),
    },
    stintsPerGame: {
      mean: round(stintCounts.reduce((sum, value) => sum + value, 0) / Math.max(1, withStints), 1),
      min: withStints ? Math.min(...stintCounts) : 0,
      max: withStints ? Math.max(...stintCounts) : 0,
    },
    gamesWithOffFloorActions: offFloorGames,
    scoreMismatches,
  };
  return { games, audit };
}

function readAudit(): AuditFile {
  const empty: AuditFile = {
    description:
      "Per-season audit of the 548 score's lineups rebuilt from ESPN play-by-play (scripts/score/build-games.ts). A game whose stints do not reconcile with its box score keeps its box lines and has no stints.",
    rule: REJECTION_RULE,
    seasons: {},
  };
  if (!fs.existsSync(AUDIT_FILE)) return empty;
  const stored = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf-8")) as AuditFile;
  return { ...empty, seasons: stored.seasons ?? {} };
}

function main(): void {
  const seasons = process.argv.slice(2).map(Number);
  if (seasons.length === 0 || seasons.some((season) => !Number.isInteger(season))) {
    throw new Error("Usage: tsx scripts/score/build-games.ts <season> [...]");
  }
  const file = readAudit();
  for (const season of seasons) {
    const { games, audit } = buildSeason(season);
    saveScoreGames(season, games);
    file.seasons[String(season)] = audit;
    const ordered = Object.fromEntries(
      Object.entries(file.seasons).sort((a, b) => Number(b[0]) - Number(a[0])),
    );
    file.seasons = ordered;
    fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
    fs.writeFileSync(AUDIT_FILE, `${JSON.stringify(file, null, 2)}\n`);
    const reasons = Object.entries(audit.rejected)
      .map(([reason, count]) => `${reason} ${count}`)
      .join(", ");
    console.log(
      `[build] ${season}: ${audit.gamesStored} of ${audit.gamesListed} games stored` +
        `${audit.emptyBox ? ` (${audit.emptyBox} with an empty box score skipped)` : ""}, ` +
        `${audit.gamesWithStints} with stints (${(audit.shareWithStints * 100).toFixed(1)}%)` +
        `${reasons ? `; rejected: ${reasons}` : ""}; source ${JSON.stringify(audit.source)}; ` +
        `plus-minus exact ${(audit.plusMinus.exact / Math.max(1, audit.plusMinus.players) * 100).toFixed(1)}%; ` +
        `possessions ratio ${audit.possessions.meanRatio} (sd ${audit.possessions.sdRatio}); ` +
        `${audit.stintsPerGame.mean} stints a game`,
    );
  }
}

main();
