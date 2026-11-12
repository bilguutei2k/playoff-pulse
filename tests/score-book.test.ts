// The book: a player's score on a date from his pieces, with decay and shrinkage toward a
// replacement value; it never reads games on or after the date. And the comparator, which
// must reproduce production's `lostValue` per expected minute.

import { describe, expect, it } from "vitest";
import { gameScore } from "@/lib/season/box-scores";
import { lostValue } from "@/lib/season/injury-model";
import { INJURY_PARAMS } from "@/lib/season/params";
import {
  combinePieces,
  comparatorExpectedMinutes,
  comparatorValue,
  fitTeamLine,
  minutesShares,
  playerValuesOnDate,
  predictTeam,
  productionLines,
  replayComparator,
  teamFeature,
  walkDates,
  type BookParams,
} from "@/lib/score/book";
import { buildSeasonTotals, seasonPieceRatings, type BoxCoefficients } from "@/lib/score/box-model";
import type { ScoreGame } from "@/lib/score/types";
import { simulateLeague } from "./support/score-league";

const COEFFICIENTS: BoxCoefficients = { beta: [0.6, -0.5, -0.15, 0.3, 0.5, -0.8, 0.4, 0.2, 1.2, 0.6, -0.3] };

const LEAGUE = { teams: 6, playersPerTeam: 9, meetings: 6, stintsPerGame: 12, possessionsPerStint: 8 };
const season2015 = simulateLeague({ ...LEAGUE, seed: "book-2015", season: 2015 });
const season2016 = simulateLeague({ ...LEAGUE, seed: "book-2016", season: 2016 }, season2015.players);
const games: ScoreGame[] = [...season2015.games, ...season2016.games];

describe("combining pieces", () => {
  const piece = { season: 2016, possessions: 4000, minutes: 1900, rating: 2.5 };

  it("equals the piece rating with one season and no shrinkage, and nearly so with large data", () => {
    expect(combinePieces([piece], 2016, { decay: 0.5, pseudoPossessions: 0, replacement: -2 }).value).toBe(2.5);
    const large = combinePieces([{ ...piece, possessions: 4_000_000 }], 2016, { decay: 0.5, pseudoPossessions: 1000, replacement: -2 });
    expect(large.value).toBeCloseTo(2.5, 2);
  });

  it("is the replacement value with no data and shrinks toward it with little", () => {
    const params: BookParams = { decay: 0.5, pseudoPossessions: 1000, replacement: -2 };
    expect(combinePieces([], 2016, params).value).toBe(-2);
    const small = combinePieces([{ ...piece, possessions: 1000 }], 2016, params).value;
    expect(small).toBeCloseTo((2.5 * 1000 - 2 * 1000) / 2000, 12);
  });

  it("weights older seasons by φ per season", () => {
    const pieces = [
      { season: 2014, possessions: 1000, minutes: 500, rating: 4 },
      { season: 2016, possessions: 1000, minutes: 500, rating: 0 },
    ];
    const value = combinePieces(pieces, 2016, { decay: 0.5, pseudoPossessions: 0, replacement: 0 });
    expect(value.weight).toBeCloseTo(1250, 12);
    expect(value.value).toBeCloseTo((4 * 250) / 1250, 12);
    expect(value.possessions).toBe(2000);
    expect(combinePieces(pieces, 2016, { decay: 0, pseudoPossessions: 0, replacement: 0 }).value).toBe(0);
    expect(() => combinePieces(pieces, 2015, { decay: 0.5, pseudoPossessions: 0, replacement: 0 })).toThrow(/2016/);
  });
});

describe("the score on a date", () => {
  const params: BookParams = { decay: 0.6, pseudoPossessions: 800, replacement: -1.5 };

  it("at the end of a single season equals the shrunk piece rating", () => {
    const values = playerValuesOnDate(season2015.games, 2015, null, COEFFICIENTS, { ...params, pseudoPossessions: 0 });
    const pieces = seasonPieceRatings(buildSeasonTotals(season2015.games, 2015), COEFFICIENTS);
    for (const piece of pieces) expect(values.get(piece.athleteId)?.value).toBeCloseTo(piece.rating, 10);
  });

  it("never uses games on or after the date", () => {
    const date = season2016.games[Math.floor(season2016.games.length / 2)].etDate;
    const before = playerValuesOnDate(games, 2016, date, COEFFICIENTS, params);
    // Rewrite every game from the date on, and add a later season: nothing may change.
    const scrambled = games.map((game) =>
      game.season === 2016 && game.etDate >= date
        ? {
            ...game,
            homeScore: game.homeScore + 40,
            box: Object.fromEntries(
              Object.entries(game.box).map(([teamId, lines]) => [teamId, lines.map((l) => ({ ...l, points: l.points + 20, steals: 9 }))]),
            ),
          }
        : game,
    );
    const later = simulateLeague({ ...LEAGUE, seed: "book-2017", season: 2017 }, season2015.players).games;
    const after = playerValuesOnDate([...scrambled, ...later], 2016, date, COEFFICIENTS, params);
    expect([...after.entries()]).toEqual([...before.entries()]);
    // And the date matters: the full season differs.
    const end = playerValuesOnDate(games, 2016, null, COEFFICIENTS, params);
    expect([...end.values()].map((v) => v.value)).not.toEqual([...before.values()].map((v) => v.value));
  });

  it("walking dates gives each date the values from games before it", () => {
    const checked: string[] = [];
    const targets = new Set([0, 40, 80].map((index) => season2016.games[index].etDate));
    walkDates(games, [2016], COEFFICIENTS, params, (season, etDate, day, valueOf) => {
      if (!targets.has(etDate)) return;
      const direct = playerValuesOnDate(games, season, etDate, COEFFICIENTS, params);
      for (const line of Object.values(day[0].box).flat()) {
        expect(valueOf(line.athleteId)?.value).toBeCloseTo(direct.get(line.athleteId)?.value as number, 10);
      }
      checked.push(etDate);
    });
    expect(checked.length).toBe(3);
  });
});

describe("the comparator", () => {
  const book = replayComparator(games);

  it("stores lines as production does: minutes rounded, Game Score to one decimal", () => {
    const game = games[0];
    const lines = productionLines(game, game.homeId);
    const raw = game.box[game.homeId].filter((l) => l.minutes > 0);
    expect(lines.length).toBe(raw.length);
    lines.forEach(([id, minutes, score], i) => {
      expect(id).toBe(raw[i].athleteId);
      expect(minutes).toBe(Math.round(raw[i].minutes));
      expect(score).toBe(Number(gameScore(raw[i]).toFixed(1)));
    });
  });

  it("unfloored value times expected minutes reproduces lostValue when positive; floored clips at zero", () => {
    let positive = 0;
    let negative = 0;
    for (const athleteId of book.keys()) {
      const unfloored = comparatorValue(book, athleteId, false) as number;
      const floored = comparatorValue(book, athleteId, true) as number;
      const lost = lostValue(book, athleteId, INJURY_PARAMS);
      const expected = comparatorExpectedMinutes(book, athleteId);
      if (unfloored > 0) {
        positive += 1;
        expect(unfloored * expected).toBeCloseTo(lost, 10);
        expect(floored).toBe(unfloored);
      } else {
        negative += 1;
        expect(lost).toBe(0);
        expect(floored).toBe(0);
      }
    }
    expect(positive).toBeGreaterThan(0);
    expect(negative + positive).toBe(book.size);
    expect(comparatorValue(book, "nobody", false)).toBeNull();
  });
});

describe("team predictions", () => {
  it("minutes shares sum to one and unknown players count in u", () => {
    const shares = minutesShares(new Map([["a", 30], ["b", 10], ["c", 0]]));
    expect(shares.map((s) => s.share)).toEqual([0.75, 0.25]);
    const feature = teamFeature(shares, (id) => (id === "a" ? 2 : null));
    expect(feature).toEqual({ weighted: 1.5, unknown: 0.25 });
  });

  it("the straight line is least squares and recovers a known line", () => {
    const rows = Array.from({ length: 40 }, (_, i) => {
      const weighted = Math.sin(i) * 2;
      const unknown = (i % 7) / 10;
      return { weighted, unknown, actual: 0.5 + 4 * weighted - 3 * unknown };
    });
    const line = fitTeamLine(rows);
    expect(line.a).toBeCloseTo(0.5, 9);
    expect(line.b).toBeCloseTo(4, 9);
    expect(line.c).toBeCloseTo(-3, 9);
    expect(predictTeam(line, { weighted: 1, unknown: 0.1 })).toBeCloseTo(4.2, 9);
    expect(fitTeamLine(rows.map((r) => ({ ...r, unknown: 0, actual: 1 + 2 * r.weighted }))).c).toBe(0);
  });
});
