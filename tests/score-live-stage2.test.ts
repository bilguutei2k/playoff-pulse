// Stage 2 of the 548 score on the live site: the frozen Stage 2 parameters equal
// docs/score/fit-stage2.json, the committed carried δ is well formed and matches the
// registered test's 2025-26 record, the live computation from stored days and stints
// equals the offline season walk on the same games, the stint store's form and checks,
// and stint collection never throws, never costs a game its player lines and stays inside
// its request cap and time budget.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSeasonTotals, seasonPieceRatings } from "@/lib/score/box-model";
import { type PriorPiece } from "@/lib/score/live";
import {
  carriedDeltaContent,
  liveOnCourt,
  onCourtProblems,
  publishedOnCourt,
  readCarriedDelta,
  type CarriedDeltaFile,
} from "@/lib/score/live-on-court";
import { emptyStintDay, readStint, stintDayProblems, storeStint, type StintDay } from "@/lib/score/live-stints";
import { CHECKPOINT_DAYS, onCourtRatingsOnDate, walkOnCourt } from "@/lib/score/on-court";
import {
  SCORE_BOOK,
  SCORE_CHECKPOINT_DAYS,
  SCORE_COEFFICIENTS,
  SCORE_DELTA_SEASON,
  SCORE_FIT_SHA256,
  SCORE_FIT_STAGE2_SHA256,
  SCORE_LIVE_SEASON,
  SCORE_MODEL_VERSION,
  SCORE_MODEL_VERSION_S2,
  SCORE_ON_COURT,
  SCORE_ON_COURT_REPLACEMENT,
} from "@/lib/score/params";
import type { ScoreGame } from "@/lib/score/types";
import { PLAYER_LINE_COLUMNS, type PlayerBoxLine, type PlayerGamesDay, type StoredPlayerLine } from "@/lib/season/player-stats";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { SeasonGame } from "@/lib/season/types";
import { collectPlayerGames } from "../scripts/live/live-availability";
import { scoresWithOnCourt } from "../scripts/live/model-views";
import { CARRIED_DELTA_PATH, loadCarriedDelta } from "../scripts/live/score-prior";
import { backfillStints, stintGameFromSummary } from "../scripts/live/stint-collect";
import { simulateSeasons } from "./support/score-league";

const ROOT = path.join(__dirname, "..");
const DOCS = path.join(ROOT, "docs", "score");
const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

describe("frozen Stage 2 parameters", () => {
  it("equal docs/score/fit-stage2.json, under the hash the freeze recorded", () => {
    const file = path.join(DOCS, "fit-stage2.json");
    expect(sha256(file)).toBe(SCORE_FIT_STAGE2_SHA256);
    expect(JSON.parse(fs.readFileSync(path.join(DOCS, "freeze-stage2.json"), "utf-8")).fitSha256).toBe(SCORE_FIT_STAGE2_SHA256);
    const fit = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(fit.version).toBe(2);
    expect(SCORE_ON_COURT).toEqual({ lambda: fit.tuning.chosen.lambda, rho: fit.tuning.chosen.rho });
    expect(SCORE_ON_COURT).toEqual({ lambda: 16000, rho: 1 });
    expect(SCORE_CHECKPOINT_DAYS).toBe(fit.settings.checkpointDays);
    expect(SCORE_CHECKPOINT_DAYS).toBe(CHECKPOINT_DAYS);
    expect(SCORE_ON_COURT_REPLACEMENT).toBe(fit.stage1.book.replacement);
    expect(SCORE_ON_COURT_REPLACEMENT).toBe(SCORE_BOOK.replacement);
    expect(fit.stage1.fitSha256).toBe(SCORE_FIT_SHA256);
    expect(SCORE_MODEL_VERSION_S2).toBe("score-2026.27-s2");
    expect(SCORE_MODEL_VERSION).toBe("score-2026.27-s1");
    expect(SCORE_DELTA_SEASON).toBe(SCORE_LIVE_SEASON - 1);
  });
});

describe("the committed carried δ", () => {
  const text = fs.readFileSync(CARRIED_DELTA_PATH, "utf-8");
  const file = JSON.parse(text) as CarriedDeltaFile;

  it("is for this model, both fits and the live season, from the walk of 2010-11 to 2025-26", () => {
    expect(file).toMatchObject({
      version: 1,
      modelVersion: SCORE_MODEL_VERSION_S2,
      fitSha256: SCORE_FIT_SHA256,
      fitStage2Sha256: SCORE_FIT_STAGE2_SHA256,
      season: SCORE_DELTA_SEASON,
      forSeason: SCORE_LIVE_SEASON,
      lambda: 16000,
      rho: 1,
      walked: [2011, 2026],
    });
    const carried = readCarriedDelta(file, SCORE_LIVE_SEASON);
    expect(carried.size).toBeGreaterThan(1000);
    expect(loadCarriedDelta(SCORE_LIVE_SEASON).problem).toBeNull();
  });

  it("matches the registered test's 2025-26 record (rounded to six decimals)", () => {
    const evaluation = JSON.parse(fs.readFileSync(path.join(DOCS, "evaluation-stage2.json"), "utf-8"));
    const record = evaluation.record.find((entry: { season: number }) => entry.season === 2026);
    const carried = readCarriedDelta(file, SCORE_LIVE_SEASON);
    const lines = [...record.positive, ...record.negative] as Array<{ athleteId: string; delta: number }>;
    expect(lines.length).toBe(30);
    for (const line of lines) expect(Math.abs((carried.get(line.athleteId) as number) - line.delta)).toBeLessThan(1e-6);
    expect(carried.get("3112335")).toBeCloseTo(2.555, 3); // Nikola Jokic
    expect(carried.get("3992")).toBeCloseTo(-2.456, 3); // James Harden
  });

  it("is in its stable form and refused, with a reason, when missing or for another model, fit or season", () => {
    expect(carriedDeltaContent(file)).toBe(text);
    const ids = Object.keys(file.players);
    expect(ids).toEqual([...ids].sort((a, b) => Number(a) - Number(b)));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "score-delta-"));
    try {
      expect(loadCarriedDelta(SCORE_LIVE_SEASON, path.join(directory, "absent.json")).problem).toMatch(/missing/);
      const broken = path.join(directory, "broken.json");
      fs.writeFileSync(broken, "{");
      expect(loadCarriedDelta(SCORE_LIVE_SEASON, broken).problem).toMatch(/unusable/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    expect(() => readCarriedDelta({ ...file, modelVersion: SCORE_MODEL_VERSION }, SCORE_LIVE_SEASON)).toThrow(/model/);
    expect(() => readCarriedDelta({ ...file, fitStage2Sha256: "0".repeat(64) }, SCORE_LIVE_SEASON)).toThrow(/another fit/);
    expect(() => readCarriedDelta(file, SCORE_LIVE_SEASON + 1)).toThrow(/not for 2028/);
    expect(() => readCarriedDelta({ ...file, rho: 0.5 }, SCORE_LIVE_SEASON)).toThrow(/λ or ρ/);
    expect(() => readCarriedDelta({ ...file, players: { "1": 40 } }, SCORE_LIVE_SEASON)).toThrow(/malformed value/);
  });
});

/** A box line in stored form without rounding, so the round trip is exact. */
function storedExactly(line: PlayerBoxLine): StoredPlayerLine {
  return PLAYER_LINE_COLUMNS.map((column) => (column === "starter" ? (line.starter ? 1 : 0) : line[column])) as StoredPlayerLine;
}

/** Engine games as the job stores them: player days and stint days. */
function asStored(games: readonly ScoreGame[]): { days: PlayerGamesDay[]; stintDays: StintDay[] } {
  const days = new Map<string, PlayerGamesDay>();
  const stintDays = new Map<string, StintDay>();
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
    const stintDay = stintDays.get(game.etDate) ?? emptyStintDay(game.etDate);
    stintDay.games[game.gameId] = {
      gameId: game.gameId,
      etDate: game.etDate,
      kind: "regular",
      homeId: game.homeId,
      awayId: game.awayId,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      audit: game.audit,
      stints: game.stints ? game.stints.map(storeStint) : null,
    };
    stintDays.set(game.etDate, stintDay);
  }
  return { days: [...days.values()], stintDays: [...stintDays.values()] };
}

describe("the live Stage 2 rating", () => {
  const LIVE = 2027;
  const games = simulateSeasons([2024, 2025, 2026, LIVE], {
    seed: "live-stage2",
    teams: 6,
    playersPerTeam: 9,
    meetings: 6,
    stintsPerGame: 12,
    possessionsPerStint: 8,
    churn: 0.3,
  });
  const past = games.filter((game) => game.season < LIVE);
  const live = games.filter((game) => game.season === LIVE);
  // The carried δ: the walk's final δ of 2025-26. The prior: every piece of the three seasons before.
  const carried = walkOnCourt(past, SCORE_COEFFICIENTS, SCORE_BOOK, [SCORE_ON_COURT]).delta[0];
  const prior = new Map<string, PriorPiece[]>();
  for (const season of [2024, 2025, 2026]) {
    for (const piece of seasonPieceRatings(buildSeasonTotals(games, season), SCORE_COEFFICIENTS)) {
      prior.set(piece.athleteId, [...(prior.get(piece.athleteId) ?? []), piece]);
    }
  }
  const first = live[0].etDate;
  const last = live.at(-1)!.etDate;
  const after = (days: number) => new Date(Date.parse(`${first}T00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const inputFor = (today: string) => {
    const before = live.filter((game) => game.etDate < today);
    return {
      season: LIVE,
      today,
      ...asStored(before),
      prior,
      carried,
      coefficients: SCORE_COEFFICIENTS,
      book: SCORE_BOOK,
      params: SCORE_ON_COURT,
      checkpointDays: SCORE_CHECKPOINT_DAYS,
      replacement: SCORE_ON_COURT_REPLACEMENT,
    };
  };

  it("equals the offline season walk on the same games: before, on and between checkpoints", () => {
    const dates = [3, 21, 26, 42, 47, 63].map((days) => after(days)).filter((date) => date <= last);
    expect(dates.length).toBeGreaterThanOrEqual(3);
    let solved = 0;
    for (const today of dates) {
      const result = liveOnCourt(inputFor(today));
      const walk = onCourtRatingsOnDate(games, LIVE, today, SCORE_COEFFICIENTS, SCORE_BOOK, SCORE_ON_COURT);
      expect([...result.ratings.keys()].sort()).toEqual([...walk.keys()].sort());
      for (const [athleteId, expected] of walk) {
        const got = result.ratings.get(athleteId)!;
        expect(got.score).toBeCloseTo(expected.box, 9);
        expect(got.delta).toBeCloseTo(expected.delta, 9);
        expect(got.rating).toBeCloseTo(expected.rating, 9);
      }
      if (result.checkpoint !== null) solved += 1;
      expect(onCourtProblems(publishedOnCourt(result))).toEqual([]);
    }
    expect(solved).toBeGreaterThanOrEqual(2);
  });

  it("holds ρ × the carried δ before the first checkpoint, and with no stints stored", () => {
    const early = liveOnCourt(inputFor(after(3)));
    expect(early.checkpoint).toBeNull();
    for (const [athleteId, value] of early.ratings) expect(value.delta).toBe(SCORE_ON_COURT.rho * (carried.get(athleteId) ?? 0));
    const today = after(26);
    const empty = liveOnCourt({ ...inputFor(today), stintDays: [] });
    expect(empty.checkpoint).not.toBeNull();
    expect(empty.rows).toBe(0);
    for (const [athleteId, value] of empty.ratings) expect(value.delta).toBe(SCORE_ON_COURT.rho * (carried.get(athleteId) ?? 0));
  });

  it("uses only regular-season, accepted stints of games before the checkpoint", () => {
    const today = after(26);
    const input = inputFor(today);
    const base = liveOnCourt(input);
    const relabelled = input.stintDays.map((day) => ({
      ...day,
      games: Object.fromEntries(
        Object.entries(day.games).map(([id, game]) => [id, day.etDate >= (base.checkpoint as string) ? { ...game, kind: "playoff" as const } : game]),
      ),
    }));
    // Games on or after the checkpoint are not in its solve, whatever their kind.
    expect(liveOnCourt({ ...input, stintDays: relabelled }).ratings).toEqual(base.ratings);
    const playoffs = input.stintDays.map((day) => ({
      ...day,
      games: Object.fromEntries(Object.entries(day.games).map(([id, game]) => [id, { ...game, kind: "playoff" as const }])),
    }));
    expect(liveOnCourt({ ...input, stintDays: playoffs }).rows).toBe(0);
  });

  it("publishes Stage 2, or falls back to Stage 1 or to nothing with the reason, and never throws", () => {
    const today = after(26);
    const { days, stintDays } = inputFor(today);
    const full = scoresWithOnCourt({ season: LIVE, today, days, prior, stintDays, carried });
    expect(full.model).toBe(SCORE_MODEL_VERSION_S2);
    expect(full.problem).toBeNull();
    for (const value of full.scores!.values()) expect(Math.abs(value.score - (value.box + (value.onCourt as number)))).toBeLessThanOrEqual(0.0011);
    const noCarried = scoresWithOnCourt({ season: LIVE, today, days, prior, stintDays, carried: null, carriedProblem: "548 score carried δ delta-2026.json is missing" });
    expect(noCarried.model).toBe(SCORE_MODEL_VERSION);
    expect(noCarried.problem).toMatch(/box scores only: 548 score carried δ delta-2026.json is missing/);
    expect([...noCarried.scores!.values()].every((value) => value.onCourt === null && value.box === value.score)).toBe(true);
    const badDate = scoresWithOnCourt({ season: LIVE, today: "soon", days, prior, stintDays, carried });
    expect(badDate.model).toBe(SCORE_MODEL_VERSION);
    expect(badDate.problem).toMatch(/on-court part was not computed/);
    const huge = new Map([...carried].map(([id]) => [id, 50]));
    const outOfBounds = scoresWithOnCourt({ season: LIVE, today, days, prior, stintDays, carried: huge });
    expect(outOfBounds.model).toBe(SCORE_MODEL_VERSION);
    expect(outOfBounds.problem).toMatch(/failed its checks/);
    const none = scoresWithOnCourt({ season: LIVE, today, days, prior: null, priorProblem: "no prior", stintDays, carried });
    expect(none).toMatchObject({ scores: null, model: null, problem: "no prior" });
  });
});

describe("the stint store", () => {
  const stint = { period: 1, seconds: 100.04, home: ["1", "2", "3", "4", "5"], away: ["6", "7", "8", "9", "10"], homePossessions: 3, awayPossessions: 2, homePoints: 5, awayPoints: 2, startMargin: 0 } as const;
  const day = (): StintDay => {
    const value = emptyStintDay("2026-11-01");
    value.games.g = {
      gameId: "g",
      etDate: "2026-11-01",
      kind: "regular",
      homeId: "1",
      awayId: "2",
      homeScore: 5,
      awayScore: 2,
      audit: { source: "substitutions", wrongCountPlays: 0, maxPlusMinusGap: 0, plusMinusMisses: 0, maxMinutesGap: 0, homePointsGap: 0, awayPointsGap: 0, rejected: null },
      stints: [storeStint({ ...stint, home: [...stint.home] as never, away: [...stint.away] as never })],
    };
    return value;
  };

  it("stores a stint compactly and reads it back", () => {
    const stored = storeStint({ ...stint, home: [...stint.home] as never, away: [...stint.away] as never });
    expect(stored).toEqual([1, 100, ["1", "2", "3", "4", "5"], ["6", "7", "8", "9", "10"], 3, 2, 5, 2, 0]);
    expect(readStint(stored)).toEqual({ ...stint, seconds: 100 });
    expect(stintDayProblems(day(), "2026-11-01")).toEqual([]);
  });

  it("catches a side without five, a player on both sides, points off the final and a rejection without a reason", () => {
    const four = day();
    four.games.g.stints![0][2] = ["1", "2", "3", "4"] as never;
    expect(stintDayProblems(four)).toEqual([expect.stringMatching(/five distinct players/)]);
    const both = day();
    both.games.g.stints![0][3] = ["5", "7", "8", "9", "10"];
    expect(stintDayProblems(both)).toEqual([expect.stringMatching(/five distinct players/)]);
    const off = day();
    off.games.g.homeScore = 7;
    expect(stintDayProblems(off)).toEqual([expect.stringMatching(/add up to 5-2, not the final 7-2/)]);
    const silent = day();
    silent.games.g.stints = null;
    expect(stintDayProblems(silent)).toEqual([expect.stringMatching(/must say why/)]);
    expect(stintDayProblems(day(), "2026-11-02")).toEqual([expect.stringMatching(/filed under/)]);
  });
});

describe("stint collection in the job", () => {
  const [A, B] = SEASON_TEAMS;
  const final = (id: string, etDate: string, tip: string): SeasonGame => ({
    id,
    season: 2027,
    kind: "regular",
    tipUtc: `${etDate}T${tip}Z`,
    etDate,
    homeId: A.id,
    awayId: B.id,
    neutral: false,
    status: "final",
    homeScore: 100,
    awayScore: 90,
  });

  it("records a game whose summary cannot be read as rejected, with the reason, and never throws", () => {
    const stored = stintGameFromSummary({ nonsense: true }, final("x", "2026-11-01", "23:30"));
    expect(stored.stints).toBeNull();
    expect(stored.audit.rejected).toMatch(/^error: /);
    expect(stintGameFromSummary(null, { ...final("y", "2026-11-01", "23:30"), status: "scheduled", homeScore: null, awayScore: null }).audit.rejected).toBe(
      "game: not final",
    );
  });

  it("backfills newest first, within its request cap and deadline, and leaves failed requests for later", async () => {
    const games = [final("g1", "2026-11-01", "23:30"), final("g2", "2026-11-02", "23:30"), final("g3", "2026-11-03", "23:30")];
    const playerDays = new Map<string, PlayerGamesDay>(
      games.map((game) => [game.etDate, { version: 1, etDate: game.etDate, athletes: {}, games: { [game.id]: {} as never } }]),
    );
    const asked: string[] = [];
    const fetchJson = async (url: string) => {
      asked.push(url);
      if (url.endsWith("g3")) throw new Error("HTTP 503");
      return { nonsense: true };
    };
    const stintDays = new Map<string, StintDay>();
    const run = await backfillStints({ stintDays, playerDays, games, fetchJson, maxRequests: 2, deadline: Date.now() + 60_000 });
    expect(asked.map((url) => url.split("=").at(-1))).toEqual(["g3", "g2"]);
    expect(run.requests).toBe(2);
    expect(run.failed).toEqual([{ gameId: "g3", problem: "HTTP 503" }]);
    expect(run.added).toEqual(["g2"]);
    expect(run.rejected.map((entry) => entry.gameId)).toEqual(["g2"]);
    expect(run.waiting).toBe(2);
    expect(stintDays.get("2026-11-02")?.games.g2.stints).toBeNull();
    // A recorded game is not asked for again; past the deadline nothing is asked.
    asked.length = 0;
    const later = await backfillStints({ stintDays, playerDays, games, fetchJson, maxRequests: 10, deadline: Date.now() - 1 });
    expect(asked).toEqual([]);
    expect(later.requests).toBe(0);
    const none = await backfillStints({ stintDays, playerDays, games, fetchJson, maxRequests: 0, deadline: Date.now() + 60_000 });
    expect(none.requests).toBe(0);
  });

  it("hands each stored game's summary to the stint builder once, and a builder failure never costs the lines", async () => {
    const labels = ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"];
    const athlete = (id: string, points: number) => ({
      athlete: { id, displayName: `Player ${id}`, position: { abbreviation: "G" } },
      starter: true,
      didNotPlay: false,
      stats: ["30", String(points), "10-20", "0-0", `${points - 20}-${points - 20}`, "5", "3", "1", "1", "0", "1", "4", "2", "+0"],
    });
    const payload = {
      boxscore: {
        players: [
          { team: { id: A.id }, statistics: [{ labels, athletes: [athlete("1", 100)] }] },
          { team: { id: B.id }, statistics: [{ labels, athletes: [athlete("2", 90)] }] },
        ],
      },
    };
    const games = [final("p1", "2026-11-01", "23:30"), final("p2", "2026-11-01", "23:45")];
    const seen: string[] = [];
    let requests = 0;
    const days = new Map<string, PlayerGamesDay>();
    const run = await collectPlayerGames(days, games, async () => {
      requests += 1;
      return payload;
    }, {
      onSummary: (game, body) => {
        seen.push(game.id);
        expect(body).toBe(payload);
        if (game.id === "p2") throw new Error("builder broke");
      },
    });
    expect(requests).toBe(2);
    expect(run.requests).toBe(2);
    expect(seen).toEqual(["p2", "p1"]);
    expect(run.added).toEqual(["p2", "p1"]);
    expect(run.summaryProblems).toEqual([{ gameId: "p2", problem: "builder broke" }]);
    expect(Object.keys(days.get("2026-11-01")!.games).sort()).toEqual(["p1", "p2"]);
  });
});

describe("the registered 2025-26 summaries, when present on disk", () => {
  const summaries = path.join(ROOT, "data", "historical", "raw", "score", "summaries", "2026");
  const built = path.join(ROOT, "data", "historical", "raw", "score", "games", "2026.json.gz");
  it.skipIf(!fs.existsSync(summaries) || !fs.existsSync(built))("rebuild into exactly the registered build's stints", async () => {
    const { loadScoreGames, loadSummary } = await import("../scripts/score/store");
    const { loadSeasonGames } = await import("../scripts/live/game-store");
    const registered = new Map(loadScoreGames(2026).map((game) => [game.gameId, game]));
    const listed = loadSeasonGames(2026).filter((game) => game.status === "final" && game.kind === "regular").slice(0, 120);
    let compared = 0;
    for (const game of listed) {
      const payload = loadSummary(2026, game.id);
      const expected = registered.get(game.id);
      if (!payload || !expected) continue;
      const stored = stintGameFromSummary(payload, game);
      expect(stored.stints).toEqual(expected.stints ? expected.stints.map(storeStint) : null);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(100);
  });
});
