// The 548 score on the live site: the frozen parameters equal docs/score/fit.json, the
// committed prior file is well formed, and the live computation from stored player days
// and prior pieces equals the engine's `playerValuesOnDate` on the same games.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { playerValuesOnDate } from "@/lib/score/book";
import { BOX_STATS, buildSeasonTotals, seasonPieceRatings } from "@/lib/score/box-model";
import {
  liveScores,
  liveScoresFromDays,
  publishedScores,
  readScorePrior,
  scoreGamesFromDays,
  scoreProblems,
  type PriorPiece,
  type ScorePriorFile,
} from "@/lib/score/live";
import {
  SCORE_BETA,
  SCORE_BOOK,
  SCORE_COEFFICIENTS,
  SCORE_FIT_SHA256,
  SCORE_LIVE_SEASON,
  SCORE_MODEL_VERSION,
  SCORE_PRIOR_SEASONS,
} from "@/lib/score/params";
import type { ScoreGame } from "@/lib/score/types";
import { PLAYER_LINE_COLUMNS, type PlayerBoxLine, type PlayerGamesDay, type StoredPlayerLine } from "@/lib/season/player-stats";
import { priorContent } from "../scripts/score/build-prior";
import { scoresFrom } from "../scripts/live/model-views";
import { loadScorePrior, SCORE_PRIOR_PATH } from "../scripts/live/score-prior";
import { simulateSeasons } from "./support/score-league";

const ROOT = path.join(__dirname, "..");
const FIT_PATH = path.join(ROOT, "docs", "score", "fit.json");

describe("frozen parameters", () => {
  const fit = JSON.parse(fs.readFileSync(FIT_PATH, "utf-8"));

  it("equal docs/score/fit.json exactly, under the hash the freeze recorded", () => {
    const hash = createHash("sha256").update(fs.readFileSync(FIT_PATH)).digest("hex");
    expect(hash).toBe(SCORE_FIT_SHA256);
    const freeze = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "score", "freeze.json"), "utf-8"));
    expect(freeze.fitSha256).toBe(SCORE_FIT_SHA256);
    expect(Object.keys(SCORE_BETA).sort()).toEqual(Object.keys(fit.primary.beta).sort());
    for (const stat of BOX_STATS) expect(SCORE_BETA[stat]).toBe(fit.primary.beta[stat]);
    expect(SCORE_COEFFICIENTS.beta).toEqual(BOX_STATS.map((stat) => fit.primary.beta[stat]));
    expect(SCORE_COEFFICIENTS.role ?? null).toBeNull();
    expect(SCORE_BOOK).toEqual({
      decay: fit.book.chosen.decay,
      pseudoPossessions: fit.book.chosen.pseudoPossessions,
      replacement: fit.book.chosen.replacement,
    });
    expect(SCORE_BOOK).toEqual({ decay: 0.25, pseudoPossessions: 250, replacement: -7 });
    expect(SCORE_MODEL_VERSION).toBe("score-2026.27-s1");
  });
});

describe("the committed prior file", () => {
  const text = fs.readFileSync(SCORE_PRIOR_PATH, "utf-8");
  const file = JSON.parse(text) as ScorePriorFile;

  it("is for the live season, this model and this fit, with the last three completed seasons", () => {
    expect(file).toMatchObject({
      version: 1,
      modelVersion: SCORE_MODEL_VERSION,
      fitSha256: SCORE_FIT_SHA256,
      forSeason: SCORE_LIVE_SEASON,
      seasons: [...SCORE_PRIOR_SEASONS],
    });
    expect(SCORE_PRIOR_SEASONS).toEqual([SCORE_LIVE_SEASON - 3, SCORE_LIVE_SEASON - 2, SCORE_LIVE_SEASON - 1]);
    const prior = readScorePrior(file, SCORE_LIVE_SEASON);
    expect(prior.size).toBeGreaterThan(500);
    const loaded = loadScorePrior(SCORE_LIVE_SEASON);
    expect(loaded.problem).toBeNull();
    expect(loaded.prior?.size).toBe(prior.size);
  });

  it("is in its stable form: sorted athletes and pieces, fixed decimals", () => {
    expect(priorContent(file)).toBe(text);
    const ids = Object.keys(file.players);
    expect(ids).toEqual([...ids].sort((a, b) => Number(a) - Number(b)));
    for (const pieces of Object.values(file.players)) {
      const sorted = [...pieces].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
      expect(pieces).toEqual(sorted);
      for (const [, , possessions, minutes, rating] of pieces) {
        expect(Number(possessions.toFixed(2))).toBe(possessions);
        expect(Number(minutes.toFixed(2))).toBe(minutes);
        expect(Number(rating.toFixed(4))).toBe(rating);
      }
    }
  });

  it("is refused, with a reason, when missing, malformed, or for another season or model", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "score-prior-"));
    try {
      expect(loadScorePrior(SCORE_LIVE_SEASON, path.join(directory, "absent.json")).problem).toMatch(/missing/);
      const broken = path.join(directory, "broken.json");
      fs.writeFileSync(broken, "{ not json");
      expect(loadScorePrior(SCORE_LIVE_SEASON, broken).problem).toMatch(/unusable/);
      expect(loadScorePrior(SCORE_LIVE_SEASON + 1).problem).toMatch(/for season 2027, not 2028/);
      expect(() => readScorePrior({ ...file, modelVersion: "score-other" }, SCORE_LIVE_SEASON)).toThrow(/model score-other/);
      expect(() => readScorePrior({ ...file, fitSha256: "0".repeat(64) }, SCORE_LIVE_SEASON)).toThrow(/another fit/);
      expect(() => readScorePrior({ ...file, players: { "1": [[2027, "1", 10, 5, 1]] } }, SCORE_LIVE_SEASON)).toThrow(/malformed piece/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

/** A box line in stored form without rounding, so the round trip is exact. */
function storedExactly(line: PlayerBoxLine): StoredPlayerLine {
  return PLAYER_LINE_COLUMNS.map((column) => (column === "starter" ? (line.starter ? 1 : 0) : line[column])) as StoredPlayerLine;
}

/** A season's engine games as the job stores them: one `PlayerGamesDay` per ET date. */
function asDays(games: readonly ScoreGame[]): PlayerGamesDay[] {
  const days = new Map<string, PlayerGamesDay>();
  for (const game of games) {
    const day = days.get(game.etDate) ?? { version: 1 as const, etDate: game.etDate, athletes: {}, games: {} };
    const teams: PlayerGamesDay["games"][string]["teams"] = {};
    for (const [teamId, lines] of Object.entries(game.box)) {
      for (const line of lines) day.athletes[line.athleteId] = { name: line.name, position: line.position };
      teams[teamId] = { lines: lines.map(storedExactly), didNotPlay: [] };
    }
    day.games[game.gameId] = {
      gameId: game.gameId,
      etDate: game.etDate,
      homeId: game.homeId,
      awayId: game.awayId,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      teams,
    };
    days.set(game.etDate, day);
  }
  return [...days.values()];
}

describe("the live score", () => {
  const LIVE = 2027;
  const games = simulateSeasons([2024, 2025, 2026, LIVE], {
    seed: "live-score",
    teams: 6,
    playersPerTeam: 9,
    meetings: 4,
    stintsPerGame: 12,
    possessionsPerStint: 8,
    churn: 0.3,
  });
  const live = games.filter((game) => game.season === LIVE);
  const firstHalf = live.filter((game) => game.etDate < live[Math.floor(live.length / 2)].etDate);
  const prior = new Map<string, PriorPiece[]>();
  for (const season of [2024, 2025, 2026]) {
    for (const piece of seasonPieceRatings(buildSeasonTotals(games, season), SCORE_COEFFICIENTS)) {
      prior.set(piece.athleteId, [...(prior.get(piece.athleteId) ?? []), piece]);
    }
  }

  it("turns stored days back into the same engine games", () => {
    const rebuilt = scoreGamesFromDays(asDays(firstHalf), LIVE);
    expect(rebuilt.map((game) => game.gameId)).toEqual(firstHalf.map((game) => game.gameId).sort((a, b) => {
      const x = firstHalf.find((game) => game.gameId === a)!;
      const y = firstHalf.find((game) => game.gameId === b)!;
      return x.etDate.localeCompare(y.etDate) || (a < b ? -1 : a > b ? 1 : 0);
    }));
    for (const game of rebuilt) {
      const original = firstHalf.find((candidate) => candidate.gameId === game.gameId)!;
      expect(game.box).toEqual(original.box);
      expect([game.homeScore, game.awayScore]).toEqual([original.homeScore, original.awayScore]);
    }
  });

  it("equals playerValuesOnDate on the same games, mid-season and at the end", () => {
    for (const current of [firstHalf, live]) {
      const scores = liveScoresFromDays({ season: LIVE, days: asDays(current), prior, coefficients: SCORE_COEFFICIENTS, params: SCORE_BOOK });
      const engine = playerValuesOnDate(
        [...games.filter((game) => game.season < LIVE), ...current],
        LIVE,
        null,
        SCORE_COEFFICIENTS,
        SCORE_BOOK,
      );
      expect([...scores.keys()].sort()).toEqual([...engine.keys()].sort());
      for (const [athleteId, value] of engine) {
        const score = scores.get(athleteId)!;
        expect(score.score).toBeCloseTo(value.value, 10);
        // Share: this season's possessions over the book's weight plus k.
        expect(score.share).toBeCloseTo(score.possessions / (value.weight + SCORE_BOOK.pseudoPossessions), 12);
        expect(score.share).toBeGreaterThanOrEqual(0);
        expect(score.share).toBeLessThan(1);
      }
      expect(scoreProblems(publishedScores(scores))).toEqual([]);
    }
  });

  it("has no score for a player with no piece, and a prior-only score with no share from this season", () => {
    const scores = liveScores({ season: LIVE, games: firstHalf, prior, coefficients: SCORE_COEFFICIENTS, params: SCORE_BOOK });
    expect(scores.has("nobody")).toBe(false);
    const onlyPrior = [...prior.keys()].find((athleteId) => !firstHalf.some((game) => Object.values(game.box).flat().some((line) => line.athleteId === athleteId)));
    expect(onlyPrior).toBeDefined();
    expect(scores.get(onlyPrior!)).toMatchObject({ possessions: 0, share: 0 });
    const empty = liveScores({ season: LIVE, games: [], prior: new Map(), coefficients: SCORE_COEFFICIENTS, params: SCORE_BOOK });
    expect(empty.size).toBe(0);
  });

  it("never throws in the job: no prior, or a failed computation, gives no scores and a reason", () => {
    const days = asDays(firstHalf);
    const ok = scoresFrom(LIVE, days, prior);
    expect(ok.problem).toBeNull();
    expect(ok.scores?.size).toBe(liveScoresFromDays({ season: LIVE, days, prior, coefficients: SCORE_COEFFICIENTS, params: SCORE_BOOK }).size);
    expect(scoresFrom(LIVE, days, null, "548 score prior prior-2026.json is missing")).toEqual({
      scores: null,
      problem: "548 score prior prior-2026.json is missing",
    });
    const future = new Map([["x", [{ season: LIVE + 1, teamId: "1", possessions: 100, minutes: 50, rating: 1 }]]]);
    const failed = scoresFrom(LIVE, days, future);
    expect(failed.scores).toBeNull();
    expect(failed.problem).toMatch(/^548 score not computed/);
  });

  it("rounds published scores to three decimals and flags a score out of bounds", () => {
    const published = publishedScores(new Map([["1", { score: 1.23456, possessions: 10, share: 0.12345 }]]));
    expect(published.get("1")).toEqual({ score: 1.235, share: 0.123 });
    expect(scoreProblems(new Map([["1", { score: 40, share: 0.5 }]]))).toHaveLength(1);
    expect(scoreProblems(new Map([["1", { score: 1, share: 1.2 }]]))).toHaveLength(1);
    expect(scoreProblems(new Map([["1", { score: Number.NaN, share: 0.5 }]]))).toHaveLength(1);
  });
});
