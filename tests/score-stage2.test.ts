// Stage 2 of the 548 score, the on-court layer: δ recovers an effect the box score cannot
// see; with no stints δ is ρ δ_prev; with a huge λ the rating is the box value; the
// running sums solve the same system as a direct solve; nothing on or after the date is
// used; the forward stint loss falls when δ carries a real effect and never predicts a
// stint from a checkpoint that saw its game; and the era guards hold for the fit, the
// freeze and the test-era evaluation.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createSeededRandom } from "@/lib/model/random";
import { playerValuesOnDate, type BookParams } from "@/lib/score/book";
import type { BoxCoefficients } from "@/lib/score/box-model";
import {
  addDays,
  addGameStints,
  checkpointDates,
  createOnCourtSystem,
  forwardStints,
  onCourtRatingsOnDate,
  solveOnCourt,
  stintRow,
  walkOnCourt,
  type OnCourtParams,
} from "@/lib/score/on-court";
import type { ScoreGame } from "@/lib/score/types";
import { runStage2Evaluation } from "../scripts/score/evaluate-stage2";
import type { ScoreFit } from "../scripts/score/fit-score";
import { runStage2Fit } from "../scripts/score/fit-stage2";
import { freezeStage2 } from "../scripts/score/freeze-stage2";
import { writeJson } from "../scripts/score/score-data";
import { collectOnCourt, forwardSummary, type Stage1Inputs } from "../scripts/score/stage2-data";
import { correlation, makePlayers, normal, rmse, simulateLeague, simulateSeasons, type SimPlayer } from "./support/score-league";

const BOX_BETA = [0.6, -0.5, -0.15, 0.3, 0.5, -0.8, 0.4, 0.2, 1.2, 0.6, -0.3];
const COEFFICIENTS: BoxCoefficients = { beta: BOX_BETA };
const BOOK: BookParams = { decay: 0.5, pseudoPossessions: 250, replacement: -3 };
const LEAGUE = { teams: 6, playersPerTeam: 9, meetings: 8, stintsPerGame: 14, possessionsPerStint: 8 };
/** The simulator's home advantage per 100 possessions, the fixed h of the forward prediction. */
const SIM_HOME = 3;

/**
 * Players whose true impact is the box score's plus a hidden effect the box cannot see
 * (split evenly between offence and defence). Half the players carry one, SD 3.
 */
function hiddenPlayers(seed: string): { players: SimPlayer[]; hidden: Map<string, number> } {
  const random = createSeededRandom(`${seed}-hidden`);
  const base = makePlayers(random, { ...LEAGUE, seed, boxBeta: BOX_BETA });
  const hidden = new Map<string, number>();
  const players = base.map((player, i) => {
    const effect = i % 2 === 0 ? 3 * normal(random) : 0;
    hidden.set(player.athleteId, effect);
    return { ...player, offence: player.offence + effect / 2, defence: player.defence + effect / 2 };
  });
  return { players, hidden };
}

/** Seasons of one league with fixed rosters. */
function seasonsOf(players: SimPlayer[], seed: string, seasons: readonly number[], meetings: number = LEAGUE.meetings): ScoreGame[] {
  return seasons.flatMap((season) => simulateLeague({ ...LEAGUE, meetings, seed: `${seed}-${season}`, season }, players).games);
}

/**
 * The shared simulator draws each side's possessions in a stint independently, so a
 * stint's margin carries a possession-imbalance noise real stints do not have (they
 * alternate). This redraws every stint's points with the same possessions for both sides
 * (their mean, rounded), from the same true effects and home advantage, and resets the
 * scores. Lineups and box lines are kept: the simulator draws box lines from rates, not
 * from stint points.
 */
function balancedPossessions(games: readonly ScoreGame[], players: readonly SimPlayer[], seed: string, home = 3): ScoreGame[] {
  const random = createSeededRandom(`${seed}-balanced`);
  const byId = new Map(players.map((p) => [p.athleteId, p]));
  const scored = (offence: readonly string[], defence: readonly string[], bonus: number, possessions: number) => {
    const sum = (ids: readonly string[], key: "offence" | "defence") => ids.reduce((t, id) => t + (byId.get(id) as SimPlayer)[key], 0);
    const chance = Math.min(0.95, Math.max(0.05, (110 + bonus + sum(offence, "offence") - sum(defence, "defence")) / 200));
    let made = 0;
    for (let i = 0; i < possessions; i += 1) if (random() < chance) made += 1;
    return 2 * made;
  };
  return games.map((game) => {
    let homeScore = 0;
    let awayScore = 0;
    const stints = (game.stints ?? []).map((stint) => {
      const possessions = Math.max(1, Math.round((stint.homePossessions + stint.awayPossessions) / 2));
      const homePoints = scored(stint.home, stint.away, home, possessions);
      const awayPoints = scored(stint.away, stint.home, 0, possessions);
      const next = { ...stint, homePossessions: possessions, awayPossessions: possessions, homePoints, awayPoints, startMargin: homeScore - awayScore };
      homeScore += homePoints;
      awayScore += awayPoints;
      return next;
    });
    return { ...game, stints, homeScore, awayScore };
  });
}

/** Gaussian elimination with partial pivoting on a full matrix: the reference solve. */
function gaussSolve(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = col + 1; r < n; r += 1) {
      const factor = a[r][col] / a[col][col];
      for (let c = col; c <= n; c += 1) a[r][c] -= factor * a[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let sum = a[r][n];
    for (let c = r + 1; c < n; c += 1) sum -= a[r][c] * x[c];
    x[r] = sum / a[r][r];
  }
  return x;
}

describe("the running normal equations", () => {
  const { players } = hiddenPlayers("direct");
  const games = simulateLeague({ ...LEAGUE, seed: "direct-2015", season: 2015, meetings: 1 }, players).games.slice(0, 8);

  it("solve the same system as a direct solve of the stated objective", () => {
    // Start tiny so the matrix has to grow while players arrive.
    const system = createOnCourtSystem(3);
    for (const game of games) addGameStints(system, game);
    const ids = system.ids;
    const prior = ids.map((_, i) => Math.sin(i + 1) * 2);
    const lambda = 37;
    const solved = solveOnCourt(system, lambda, prior);

    // Direct: the design X (players, then h), W, y from the stints themselves.
    const column = new Map(ids.map((id, i) => [id, i]));
    const n = ids.length + 1;
    const xtx = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const xty = new Array<number>(n).fill(0);
    let rows = 0;
    for (const game of games) {
      for (const stint of game.stints ?? []) {
        const row = stintRow(stint);
        if (!row) continue;
        rows += 1;
        const x = new Array<number>(n).fill(0);
        for (const id of row.home) x[column.get(id) as number] = 1;
        for (const id of row.away) x[column.get(id) as number] = -1;
        x[n - 1] = 1;
        for (let i = 0; i < n; i += 1) {
          xty[i] += row.w * x[i] * row.y;
          for (let j = 0; j < n; j += 1) xtx[i][j] += row.w * x[i] * x[j];
        }
      }
    }
    expect(system.rows).toBe(rows);
    for (let i = 0; i < n - 1; i += 1) {
      xtx[i][i] += lambda;
      xty[i] += lambda * prior[i];
    }
    const direct = gaussSolve(xtx, xty);
    for (let i = 0; i < ids.length; i += 1) expect(solved.rating[i]).toBeCloseTo(direct[i], 9);
    expect(solved.home).toBeCloseTo(direct[n - 1], 9);

    // And the solution minimises the objective: nudging any coordinate raises it.
    const objective = (r: number[], h: number) => {
      let total = 0;
      for (const game of games) {
        for (const stint of game.stints ?? []) {
          const row = stintRow(stint);
          if (!row) continue;
          let fitted = h;
          for (const id of row.home) fitted += r[column.get(id) as number];
          for (const id of row.away) fitted -= r[column.get(id) as number];
          total += row.w * (row.y - fitted) ** 2;
        }
      }
      return total + lambda * r.reduce((sum, value, i) => sum + (value - prior[i]) ** 2, 0);
    };
    const best = Array.from(solved.rating);
    const at = objective(best, solved.home);
    for (const i of [0, 5, ids.length - 1]) {
      const nudged = [...best];
      nudged[i] += 0.01;
      expect(objective(nudged, solved.home)).toBeGreaterThan(at);
    }
    expect(objective(best, solved.home + 0.01)).toBeGreaterThan(at);
  });

  it("refuses a stint that lists a player twice", () => {
    const stint = games[0].stints?.[0];
    if (!stint) throw new Error("no stint");
    const broken = { ...stint, away: [stint.home[0], ...stint.away.slice(1)] as typeof stint.away };
    const system = createOnCourtSystem();
    expect(() => addGameStints(system, { ...games[0], stints: [broken] })).toThrow(/twice/);
  });
});

describe("checkpoints", () => {
  it("fall every 21 days from the first game, up to the last date", () => {
    expect(addDays("2015-12-25", 10)).toBe("2016-01-04");
    expect(checkpointDates("2015-10-27", "2015-12-15")).toEqual(["2015-11-17", "2015-12-08"]);
    expect(checkpointDates("2015-10-27", "2015-11-17")).toEqual(["2015-11-17"]);
    expect(checkpointDates("2015-10-27", "2015-11-16")).toEqual([]);
  });
});

describe("the on-court layer on a simulated league", () => {
  const { players, hidden } = hiddenPlayers("hidden");
  // Enough possessions per player for lineup data to see a three-point effect.
  const games = balancedPossessions(seasonsOf(players, "hidden", [2015, 2016], 60), players, "hidden");
  const params: OnCourtParams = { lambda: 300, rho: 0.5 };

  it("δ recovers an effect the box score cannot see, and the rating beats the box value", () => {
    const end = onCourtRatingsOnDate(games, 2016, null, COEFFICIENTS, BOOK, params);
    const ids = players.map((p) => p.athleteId).filter((id) => end.has(id));
    expect(ids.length).toBe(players.length);
    const deltas = ids.map((id) => end.get(id)?.delta as number);
    const hiddenEffects = ids.map((id) => hidden.get(id) as number);
    const truth = ids.map((id) => {
      const player = players.find((p) => p.athleteId === id) as SimPlayer;
      return player.offence + player.defence;
    });
    const r = correlation(deltas, hiddenEffects);
    // δ's own target is the truth minus the box value (which carries a fifth of the team's
    // hidden effects through its team term).
    const target = correlation(
      deltas,
      ids.map((id, i) => truth[i] - (end.get(id)?.box as number)),
    );
    const plain = ids.filter((id) => hidden.get(id) === 0).map((id) => end.get(id)?.delta as number);
    // Error against the true total effect, in the rating's own units.
    const rating = rmse(
      ids.map((id) => end.get(id)?.rating as number),
      truth,
    );
    const box = rmse(
      ids.map((id) => end.get(id)?.box as number),
      truth,
    );
    console.log(`[stage2 sim] corr(δ, hidden) ${r.toFixed(3)}, corr(δ, truth − box) ${target.toFixed(3)}; RMSE against truth: rating ${rating.toFixed(3)}, box ${box.toFixed(3)}`);
    expect(r).toBeGreaterThan(0.6);
    expect(target).toBeGreaterThan(0.6);
    // Players without a hidden effect get a δ near zero on average.
    expect(Math.abs(plain.reduce((s, v) => s + v, 0) / plain.length)).toBeLessThan(0.5);
    expect(rating).toBeLessThan(0.9 * box);
  });

  it("with a huge λ the rating equals the Stage 1 value", () => {
    const stage1 = playerValuesOnDate(games, 2016, null, COEFFICIENTS, BOOK);
    const end = onCourtRatingsOnDate(games, 2016, null, COEFFICIENTS, BOOK, { lambda: 1e12, rho: 0.5 });
    expect(end.size).toBe(stage1.size);
    for (const [id, value] of end) {
      expect(value.box).toBe(stage1.get(id)?.value);
      expect(Math.abs(value.delta)).toBeLessThan(1e-6);
      expect(value.rating).toBeCloseTo(value.box, 6);
    }
  });

  it("the Stage 1 value on a date is the book's, and δ only moves at checkpoints", () => {
    const dates = [...new Set(games.filter((g) => g.season === 2016).map((g) => g.etDate))].sort();
    const first = dates[0];
    const checkpoint = addDays(first, 21);
    const before = dates.filter((d) => d < checkpoint);
    const after = dates.filter((d) => d > checkpoint && d < addDays(first, 42));
    expect(after.length).toBeGreaterThan(2);
    // Two dates inside the same checkpoint window hold the same δ; the box value moves.
    const a = onCourtRatingsOnDate(games, 2016, after[0], COEFFICIENTS, BOOK, params);
    const b = onCourtRatingsOnDate(games, 2016, after[after.length - 1], COEFFICIENTS, BOOK, params);
    const stage1 = playerValuesOnDate(games, 2016, after[0], COEFFICIENTS, BOOK);
    let boxMoved = false;
    for (const [id, value] of a) {
      expect(value.box).toBe(stage1.get(id)?.value);
      expect(b.get(id)?.delta).toBe(value.delta);
      if (b.get(id)?.box !== value.box) boxMoved = true;
    }
    expect(boxMoved).toBe(true);
    // Before the season's first checkpoint, δ is ρ times last season's final δ.
    const last = onCourtRatingsOnDate(games, 2015, null, COEFFICIENTS, BOOK, params);
    const early = onCourtRatingsOnDate(games, 2016, before[before.length - 1], COEFFICIENTS, BOOK, params);
    for (const [id, value] of early) expect(value.delta).toBeCloseTo(params.rho * (last.get(id)?.delta ?? 0), 12);
    // And before the season's first game, too.
    const opening = onCourtRatingsOnDate(games, 2016, first, COEFFICIENTS, BOOK, params);
    for (const [id, value] of opening) expect(value.delta).toBeCloseTo(params.rho * (last.get(id)?.delta ?? 0), 12);
  });

  it("with no stints in a season, δ is ρ times the previous final δ", () => {
    const blind = games.map((game) => (game.season === 2016 ? { ...game, stints: null } : game));
    const last = onCourtRatingsOnDate(blind, 2015, null, COEFFICIENTS, BOOK, params);
    const end = onCourtRatingsOnDate(blind, 2016, null, COEFFICIENTS, BOOK, params);
    let nonzero = 0;
    for (const [id, value] of end) {
      const previous = last.get(id)?.delta ?? 0;
      expect(value.delta).toBe(params.rho * previous);
      if (previous !== 0) nonzero += 1;
    }
    expect(nonzero).toBeGreaterThan(40);
    // A player absent from a season keeps decaying: two seasons later, ρ² δ.
    const later = onCourtRatingsOnDate(blind, 2017, null, COEFFICIENTS, BOOK, params);
    for (const [id, value] of later) expect(value.delta).toBeCloseTo(params.rho ** 2 * (last.get(id)?.delta ?? 0), 12);
  });

  it("never uses a game on or after the date, nor a later season", () => {
    const dates = [...new Set(games.filter((g) => g.season === 2016).map((g) => g.etDate))].sort();
    const date = dates[Math.floor(dates.length * 0.8)];
    const reference = onCourtRatingsOnDate(games, 2016, date, COEFFICIENTS, BOOK, params);
    const scrambled = [
      ...games.map((game) =>
        game.season === 2016 && game.etDate >= date
          ? {
              ...game,
              homeScore: game.homeScore + 40,
              stints: (game.stints ?? []).map((stint) => ({ ...stint, homePoints: stint.homePoints + 10 })),
              box: Object.fromEntries(Object.entries(game.box).map(([team, lines]) => [team, lines.map((l) => ({ ...l, points: l.points + 9 }))])),
            }
          : game,
      ),
      ...seasonsOf(players, "later", [2017]),
    ];
    const again = onCourtRatingsOnDate(scrambled, 2016, date, COEFFICIENTS, BOOK, params);
    expect([...again.entries()]).toEqual([...reference.entries()]);
    // The walk itself refuses a game on or after the date it stops before.
    expect(() =>
      walkOnCourt(games.filter((g) => g.season === 2016), COEFFICIENTS, BOOK, [params], {}, { stopBefore: date }),
    ).toThrow(/on or after/);
  });

  it("no stint is predicted from a checkpoint that used its own game, nor from any later result", () => {
    type Seen = { key: string; etDate: string; checkpoint: string | null; stage1: number; stage2: number };
    const run = (input: readonly ScoreGame[]) => {
      const seen: Seen[] = [];
      walkOnCourt(input, COEFFICIENTS, BOOK, [params], {
        date: (event) =>
          forwardStints(event, 1, SIM_HOME, BOOK.replacement, (stint) =>
            seen.push({ key: `${stint.gameId}#${seen.length}`, etDate: stint.etDate, checkpoint: stint.checkpoint, stage1: stint.stage1, stage2: stint.stage2[0] }),
          ),
      });
      return seen;
    };
    const reference = run(games);
    expect(reference.length).toBeGreaterThan(10000);
    // A checkpoint on date D used games before D only; every stint it predicts is on or after D.
    for (const stint of reference) if (stint.checkpoint !== null) expect(stint.checkpoint <= stint.etDate).toBe(true);
    expect(reference.some((stint) => stint.checkpoint !== null && stint.checkpoint === stint.etDate)).toBe(true);

    // Rewrite every result (stints and box lines) of one mid-season date. Each stint up to
    // the next checkpoint keeps exactly its prediction, its own date's included; a later
    // one moves.
    const dates = [...new Set(games.filter((g) => g.season === 2016).map((g) => g.etDate))].sort();
    const date = dates[Math.floor(dates.length / 2)];
    const next = checkpointDates(dates[0], dates[dates.length - 1]).find((d) => d > date) as string;
    expect(next).toBeDefined();
    const scrambled = games.map((game) =>
      game.etDate === date
        ? {
            ...game,
            stints: (game.stints ?? []).map((stint) => ({ ...stint, homePoints: stint.homePoints + 12 })),
            box: Object.fromEntries(Object.entries(game.box).map(([team, lines]) => [team, lines.map((l) => ({ ...l, points: l.points + 9 }))])),
          }
        : game,
    );
    const again = run(scrambled);
    expect(again.map((s) => s.key)).toEqual(reference.map((s) => s.key));
    let before = 0;
    let moved = 0;
    reference.forEach((stint, i) => {
      if (stint.etDate < next) {
        expect(again[i].stage1).toBe(stint.stage1);
        expect(again[i].stage2).toBe(stint.stage2);
        if (stint.etDate === date) before += 1;
      } else if (again[i].stage2 !== stint.stage2) {
        moved += 1;
      }
    });
    expect(before).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(0);
  });

  it("several settings in one walk give what each gives alone", () => {
    const settings = [params, { lambda: 2000, rho: 1 }, { lambda: 300, rho: 0 }];
    const together = walkOnCourt(games, COEFFICIENTS, BOOK, settings);
    settings.forEach((setting, s) => {
      const alone = walkOnCourt(games, COEFFICIENTS, BOOK, [setting]);
      for (const [id, value] of alone.delta[0]) expect(together.delta[s].get(id)).toBeCloseTo(value, 10);
    });
  });
});

describe("the forward stint loss on a simulated league", () => {
  // Stint noise swamps a small hidden effect: in the league above even the true ratings
  // beat Stage 1's forward loss by about 0.1%. Here half the players carry a hidden effect
  // of SD 8 and stints are longer, so getting the split right is visible in the loss.
  const options = { teams: 6, playersPerTeam: 9, meetings: 40, stintsPerGame: 14, possessionsPerStint: 12 };
  const league = (hiddenSd: number) => {
    const random = createSeededRandom("forward-hidden");
    const players = makePlayers(random, { ...options, seed: "forward", boxBeta: BOX_BETA }).map((player, i) => {
      const effect = i % 2 === 0 ? hiddenSd * normal(random) : 0;
      return { ...player, offence: player.offence + effect / 2, defence: player.defence + effect / 2 };
    });
    return [2015, 2016].flatMap((season) => simulateLeague({ ...options, seed: `forward-${season}`, season }, players).games);
  };
  const stage1 = { coefficients: COEFFICIENTS, book: BOOK, home: SIM_HOME };
  const settings: OnCourtParams[] = [{ lambda: 3000, rho: 0.5 }, { lambda: 1e12, rho: 0.5 }];

  it("falls when δ carries a real hidden effect, rises when there is none, and equals Stage 1's with a huge λ", () => {
    const hiddenRun = collectOnCourt(league(8), stage1, settings, [2016]).forward;
    const tuned = forwardSummary(hiddenRun, 0);
    const plain = forwardSummary(collectOnCourt(league(0), stage1, settings, [2016]).forward, 0);
    console.log(
      `[stage2 sim] forward loss, Stage 2 against Stage 1: ${(100 * tuned.improvement).toFixed(2)}% lower with hidden effects, ` +
        `${(100 * plain.improvement).toFixed(2)}% without`,
    );
    expect(tuned.stints).toBeGreaterThan(8000);
    expect(tuned.stage2).toBeLessThan(tuned.stage1);
    expect(tuned.improvement).toBeGreaterThan(0.01);
    // Without anything to find, δ only adds noise.
    expect(plain.improvement).toBeLessThan(0);
    // δ ≈ 0 is Stage 1.
    const frozen = forwardSummary(hiddenRun, 1);
    expect(Math.abs(frozen.ratio - 1)).toBeLessThan(1e-8);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Era guards and the pipeline
// ---------------------------------------------------------------------------

/** A Stage 1 stand-in with exactly the fields Stage 2 reads. */
function simulatedStage1(): Stage1Inputs {
  const fit = {
    book: { chosen: { ...BOOK, rmse: Number.NaN, endpointRmse: Number.NaN } },
    teamLines: { score: { a: 0, b: 5, c: -10 } },
    gameLines: { score: { a: 3, b: 5, c: -10, trainingMae: Number.NaN, games: 0 } },
    primary: { home: SIM_HOME },
    trainingRmse: { score: Number.NaN },
    rapm: { frozenPenalties: { offence: 1000, defence: 1000 } },
  } as unknown as ScoreFit;
  return { fit, fitSha256: "simulated", coefficients: COEFFICIENTS, book: BOOK, home: SIM_HOME };
}

describe("era guards", () => {
  it("the fit refuses any season after 2020, before reading one", () => {
    const asked: number[] = [];
    const loader = (season: number) => {
      asked.push(season);
      return [] as ScoreGame[];
    };
    expect(() => runStage2Fit({ loader, stage1: simulatedStage1(), seasons: [2019, 2020, 2021] })).toThrow(/2021/);
    expect(asked).toEqual([]);
  });

  describe("a test-era evaluation and the freeze", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "score-stage2-freeze-"));
    afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
    const stage1 = {
      registration: path.join(directory, "registration.md"),
      fit: path.join(directory, "fit.json"),
      freeze: path.join(directory, "freeze.json"),
    };
    const stage2 = {
      registration: path.join(directory, "registration-stage2.md"),
      fit: path.join(directory, "fit-stage2.json"),
      freeze: path.join(directory, "freeze-stage2.json"),
    };
    const evaluation = path.join(directory, "evaluation-stage2.json");
    const asked: number[] = [];
    const loader = (season: number) => {
      asked.push(season);
      return [] as ScoreGame[];
    };
    const run = () => runStage2Evaluation({ era: "test", loader, freezePaths: { stage1, stage2 } });

    it("throws without either freeze, before loading any season", () => {
      expect(run).toThrow(/No freeze/);
      fs.writeFileSync(stage1.registration, "# Stage 1\n");
      writeJson(stage1.fit, { version: 2 });
      writeJson(stage1.freeze, {
        registrationSha256: "0".repeat(64),
        fitSha256: "0".repeat(64),
        frozenAt: "2026-11-12T00:00:00.000Z",
      });
      expect(run).toThrow(/registration file changed/);
      expect(asked).toEqual([]);
    });

    it("the freeze refuses a draft, unfilled values or a finished test", () => {
      writeJson(stage2.fit, { version: 1 });
      fs.writeFileSync(stage2.registration, "**Status: draft.** Stage 2\n");
      expect(() => freezeStage2({ ...stage2, evaluation })).toThrow(/draft/);
      fs.writeFileSync(stage2.registration, "**Status: final.**\n| λ | TO BE FILLED |\n");
      expect(() => freezeStage2({ ...stage2, evaluation })).toThrow(/TO BE FILLED/);
      fs.writeFileSync(stage2.registration, "**Status: final.**\n");
      fs.writeFileSync(evaluation, "{}");
      expect(() => freezeStage2({ ...stage2, evaluation })).toThrow(/can no longer be re-frozen/);
      fs.rmSync(evaluation);
    });

    it("throws when a Stage 2 file changed since its freeze, or a fit is passed in", () => {
      // A valid Stage 1 freeze, then a valid Stage 2 freeze.
      const record = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      writeJson(stage1.freeze, { registrationSha256: record(stage1.registration), fitSha256: record(stage1.fit), frozenAt: "2026-11-12T00:00:00.000Z" });
      expect(run).toThrow(/No freeze at .*freeze-stage2/);
      freezeStage2({ ...stage2, evaluation, now: () => new Date("2026-11-12T00:00:00Z") });
      fs.appendFileSync(stage2.registration, "Changed after the freeze.\n");
      expect(run).toThrow(/registration file changed/);
      fs.writeFileSync(stage2.registration, "**Status: final.**\n");
      writeJson(stage2.fit, { version: 2 });
      expect(run).toThrow(/fit file changed/);
      writeJson(stage2.fit, { version: 1 });
      expect(() =>
        runStage2Evaluation({ era: "test", loader, freezePaths: { stage1, stage2 }, fit: {} as never }),
      ).toThrow(/never a fit passed in/);
      expect(asked).toEqual([]);
    });
  });
});

describe("the Stage 2 pipeline on a simulated league", () => {
  const seasons = Array.from({ length: 10 }, (_, i) => 2011 + i);
  const games = simulateSeasons([...seasons, 2021], {
    seed: "stage2-pipeline",
    teams: 6,
    playersPerTeam: 9,
    meetings: 4,
    stintsPerGame: 12,
    possessionsPerStint: 8,
    boxBeta: BOX_BETA,
    churn: 0.3,
  });
  const asked: number[] = [];
  const loader = (season: number) => {
    asked.push(season);
    return games.filter((game) => game.season === season);
  };

  it("fits on the training era only, deterministically, extends λ on an edge, and evaluates", () => {
    const stage1 = simulatedStage1();
    const grid = { lambda: [100, 1000], rho: [0, 1] };
    const fit = runStage2Fit({ loader, stage1, grid, maxExtensions: 1 });
    expect(Math.max(...asked)).toBe(2020);
    expect(JSON.stringify(runStage2Fit({ loader, stage1, grid, maxExtensions: 1 }))).toBe(JSON.stringify(fit));
    expect(fit.trainingPairs).toBe(9 * 6);
    expect(fit.tuning.table.length).toBe((2 + fit.settings.lambdaExtensions.length) * 2);
    expect(fit.settings.lambdaExtensions.length).toBeLessThanOrEqual(2);
    expect(fit.tuning.table.every((cell) => [cell.forwardLoss, cell.gameRmse, cell.endpointRmse].every(Number.isFinite))).toBe(true);
    expect(Number.isFinite(fit.stage1.criterionRecomputed)).toBe(true);
    // The chosen cell is the best forward loss; the other criteria are reported beside it.
    expect(fit.tuning.table.every((cell) => cell.forwardLoss >= fit.tuning.chosen.forwardLoss)).toBe(true);
    expect(fit.tuning.otherCriteria.gameRmse.gameRmse).toBe(Math.min(...fit.tuning.table.map((c) => c.gameRmse)));
    expect(fit.stage1.home).toBe(SIM_HOME);
    expect(Number.isFinite(fit.slope.stage1.gamma)).toBe(true);

    asked.length = 0;
    const training = runStage2Evaluation({ era: "training", loader, fit, stage1 });
    expect(Math.max(...asked)).toBe(2020);
    expect(training.teamSeasons).toBe(54);
    expect(training.team.rmse.stage2).toBeCloseTo(fit.teamTrainingRmse, 9);
    expect(training.game.rmse.stage2).toBeCloseTo(fit.gameLine.trainingRmse, 9);
    expect(training.team.rmseLeaveSeasonOut?.stage1).toBeCloseTo(fit.stage1.endpointRmseLeaveSeasonOut, 9);
    expect(training.endpoint.passed).toBe(training.endpoint.team.passed && training.endpoint.forward.passed);
    // The forward loss fits nothing: the evaluation reproduces the fit's criterion exactly.
    expect(training.forward.stage2).toBeCloseTo(fit.tuning.chosen.forwardLoss, 9);
    expect(training.forward.stage1).toBeCloseTo(fit.stage1.forwardLoss, 9);
    expect(training.bootstrap.forwardByGame.draws).toBe(2000);
    expect(training.bootstrap.forwardBySeason.low).toBeLessThanOrEqual(training.bootstrap.forwardBySeason.high);
    expect(training.ownerChecks.length).toBe(6);
    expect(training.faceValidity?.season).toBe(2020);
    expect(training.record).toBeNull();
    expect(() => runStage2Evaluation({ era: "training", loader, fit: { ...fit, stage1: { ...fit.stage1, fitSha256: "other" } }, stage1 })).toThrow(
      /another Stage 1 fit/,
    );
  }, 120_000);
});
