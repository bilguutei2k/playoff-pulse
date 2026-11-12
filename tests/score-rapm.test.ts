// RAPM on a simulated league with known player effects: it recovers them better than raw
// plus-minus, moves toward a supplied prior when data is thin, and its Cholesky solver
// matches a hand-solved system. Cross-validation is seeded and deterministic.

import { describe, expect, it } from "vitest";
import { createSeededRandom } from "@/lib/model/random";
import {
  accumulateNormalEquations,
  buildRapmDesign,
  choleskyBackSolve,
  choleskyInPlace,
  crossValidateRapm,
  fitRapm,
  gameFolds,
  prepareRapmFolds,
  rawPlusMinus,
  searchRapmPenalties,
  solveSymmetric,
} from "@/lib/score/rapm";
import { correlation, makePlayers, playGame, rmse, simulateLeague, type SimPlayer } from "./support/score-league";

describe("Cholesky solver", () => {
  it("matches a hand-solved 3 × 3 system", () => {
    // A = [[4, 2, 2], [2, 5, 3], [2, 3, 6]], b = A · [1, 2, 3] = [14, 21, 26].
    // L = [[2, 0, 0], [1, 2, 0], [1, 1, 2]] by hand; x = [1, 2, 3].
    const matrix = Float64Array.from([4, 2, 2, 2, 5, 3, 2, 3, 6]);
    const factor = Float64Array.from(matrix);
    choleskyInPlace(factor, 3);
    expect([factor[0], factor[3], factor[4], factor[6], factor[7], factor[8]]).toEqual([2, 1, 2, 1, 1, 2]);
    const x = choleskyBackSolve(factor, 3, [14, 21, 26]);
    expect(Array.from(x).map((v) => Number(v.toFixed(12)))).toEqual([1, 2, 3]);
    expect(Array.from(solveSymmetric(matrix, 3, [14, 21, 26])).map((v) => Number(v.toFixed(12)))).toEqual([1, 2, 3]);
  });

  it("reads only the lower triangle and rejects an indefinite matrix", () => {
    const lowerOnly = Float64Array.from([4, 99, 99, 2, 5, 99, 2, 3, 6]);
    expect(Array.from(solveSymmetric(lowerOnly, 3, [14, 21, 26])).map((v) => Number(v.toFixed(12)))).toEqual([1, 2, 3]);
    expect(() => solveSymmetric(Float64Array.from([1, 0, 2, 1]), 2, [1, 1])).toThrow(/positive definite/);
  });

  it("solves a random 60 × 60 system to 1e-9", () => {
    const random = createSeededRandom("cholesky-60");
    const n = 60;
    const b = Array.from({ length: n * n }, () => random() - 0.5);
    const matrix = new Float64Array(n * n);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        let sum = i === j ? 1 : 0;
        for (let k = 0; k < n; k += 1) sum += b[i * n + k] * b[j * n + k];
        matrix[i * n + j] = sum;
      }
    }
    const truth = Array.from({ length: n }, () => random() * 4 - 2);
    const rhs = truth.map((_, i) => truth.reduce((s, v, j) => s + matrix[i * n + j] * v, 0));
    const solved = solveSymmetric(matrix, n, rhs);
    expect(Math.max(...truth.map((v, i) => Math.abs(v - solved[i])))).toBeLessThan(1e-9);
  });
});

const LEAGUE = {
  seed: "rapm-league",
  teams: 12,
  playersPerTeam: 10,
  meetings: 16,
  stintsPerGame: 14,
  possessionsPerStint: 8,
  effectSd: 2,
  teamSd: 1,
  home: 3,
};

describe("RAPM on a simulated league", () => {
  const league = simulateLeague(LEAGUE);
  const design = buildRapmDesign(league.games);
  const truth = new Map(league.players.map((player) => [player.athleteId, player]));

  it("builds one row per side with possessions, weighted by possessions", () => {
    const stints = league.games.flatMap((game) => game.stints ?? []);
    const expected = stints.reduce((n, s) => n + (s.homePossessions > 0 ? 1 : 0) + (s.awayPossessions > 0 ? 1 : 0), 0);
    expect(design.rowCount).toBe(expected);
    const first = stints[0];
    expect(design.rowY[0]).toBeCloseTo((100 * first.homePoints) / first.homePossessions, 10);
    expect(design.rowWeight[0]).toBe(first.homePossessions);
    expect(design.rowHome[0]).toBe(1);
    expect(design.rowHome[1]).toBe(0);
  });

  it("recovers player effects better than raw plus-minus", () => {
    const fit = fitRapm(design, { offence: 1000, defence: 1000 });
    const raw = rawPlusMinus(design);
    const ids = fit.players.map((player) => player.athleteId);
    const trueTotal = ids.map((id) => (truth.get(id) as SimPlayer).offence + (truth.get(id) as SimPlayer).defence);
    const rapmTotal = fit.players.map((player) => player.total);
    const rawTotal = ids.map((id) => raw.get(id) as number);
    const rapmCorrelation = correlation(trueTotal, rapmTotal);
    const rawCorrelation = correlation(trueTotal, rawTotal);
    // About 0.84 against 0.59 at this seed.
    expect(rapmCorrelation).toBeGreaterThan(0.78);
    expect(rapmCorrelation).toBeGreaterThan(rawCorrelation + 0.15);
    expect(rmse(trueTotal, rapmTotal)).toBeLessThan(rmse(trueTotal, rawTotal));
    // Offence and defence separately, both well above chance.
    const offence = correlation(ids.map((id) => (truth.get(id) as SimPlayer).offence), fit.players.map((p) => p.offence));
    const defence = correlation(ids.map((id) => (truth.get(id) as SimPlayer).defence), fit.players.map((p) => p.defence));
    expect(offence).toBeGreaterThan(0.6);
    expect(defence).toBeGreaterThan(0.6);
    // The unpenalised home term is near the simulated 3 points per 100.
    expect(Math.abs(fit.homeOffence - LEAGUE.home)).toBeLessThan(1.5);
    console.log(
      `[rapm recovery] r(total) RAPM ${rapmCorrelation.toFixed(3)}, raw ${rawCorrelation.toFixed(3)}; ` +
        `RMSE RAPM ${rmse(trueTotal, rapmTotal).toFixed(2)}, raw ${rmse(trueTotal, rawTotal).toFixed(2)}; ` +
        `r(offence) ${offence.toFixed(3)}, r(defence) ${defence.toFixed(3)}; h ${fit.homeOffence.toFixed(2)}`,
    );
  });

  it("moves toward a supplied prior when a player's data is thin", () => {
    // One extra player who appears in a single stint of one extra game.
    const random = createSeededRandom("thin-player");
    const rookie: SimPlayer = { ...league.players[0], athleteId: "9999", offence: 0, defence: 0, playing: 1 };
    const homeRoster = [rookie, ...league.players.filter((p) => p.teamId === league.players[0].teamId).slice(1, 5)];
    const awayRoster = league.players.filter((p) => p.teamId === league.players[10].teamId).slice(0, 5);
    const extra = playGame(random, "thin-1", 2015, "2015-04-30", homeRoster, awayRoster, {
      stintsPerGame: 1,
      possessionsPerStint: 8,
      home: 3,
    });
    const thin = buildRapmDesign([...league.games, extra]);
    const penalties = { offence: 600, defence: 600 };
    const plain = fitRapm(thin, penalties).players.find((p) => p.athleteId === "9999");
    const prior = new Map([["9999", { offence: 4, defence: -3 }]]);
    const pulled = fitRapm(thin, penalties, prior).players.find((p) => p.athleteId === "9999");
    expect(plain && pulled).toBeTruthy();
    if (!plain || !pulled) return;
    expect(Math.abs(pulled.offence - 4)).toBeLessThan(Math.abs(plain.offence - 4));
    expect(Math.abs(pulled.defence + 3)).toBeLessThan(Math.abs(plain.defence + 3));
    expect(pulled.offence).toBeGreaterThan(3);
    expect(pulled.defence).toBeLessThan(-2);
    // A well-observed player barely moves with the same prior.
    const regular = league.players[3].athleteId;
    const heavyPrior = new Map([[regular, { offence: 4, defence: -3 }]]);
    const before = fitRapm(design, penalties).players.find((p) => p.athleteId === regular);
    const after = fitRapm(design, penalties, heavyPrior).players.find((p) => p.athleteId === regular);
    expect(Math.abs((after?.offence ?? 0) - (before?.offence ?? 0))).toBeLessThan(1.5);
  });

  it("the normal equations match a brute-force XᵀWX on a small design", () => {
    const small = buildRapmDesign(league.games.slice(0, 3));
    const { n, matrix, rhs } = accumulateNormalEquations(small);
    const seasonCount = small.seasons.length;
    const players = small.athleteIds.length;
    const dense = new Float64Array(n * n);
    const denseRhs = new Float64Array(n);
    for (let row = 0; row < small.rowCount; row += 1) {
      const x = new Float64Array(n);
      x[small.rowSeason[row]] = 1;
      if (small.rowHome[row]) x[seasonCount] = 1;
      for (let slot = 0; slot < 5; slot += 1) x[seasonCount + 1 + small.rowPlayers[row * 10 + slot]] = 1;
      for (let slot = 5; slot < 10; slot += 1) x[seasonCount + 1 + players + small.rowPlayers[row * 10 + slot]] = -1;
      for (let i = 0; i < n; i += 1) {
        denseRhs[i] += small.rowWeight[row] * x[i] * small.rowY[row];
        for (let j = 0; j <= i; j += 1) dense[i * n + j] += small.rowWeight[row] * x[i] * x[j];
      }
    }
    for (let i = 0; i < n; i += 1) {
      expect(rhs[i]).toBeCloseTo(denseRhs[i], 8);
      for (let j = 0; j <= i; j += 1) expect(matrix[i * n + j]).toBeCloseTo(dense[i * n + j], 8);
    }
  });

  it("cross-validates by game, deterministically, and prefers a penalty inside the grid", () => {
    const folds = gameFolds(design.gameIds, 5, "cv");
    expect(Array.from(folds)).toEqual(Array.from(gameFolds(design.gameIds, 5, "cv")));
    const counts = [0, 0, 0, 0, 0];
    for (const f of folds) counts[f] += 1;
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    const prepared = prepareRapmFolds(design, 5, "cv");
    const grid = [10, 100, 1000, 10000, 100000].map((lambda) => ({ offence: lambda, defence: lambda }));
    const cv = crossValidateRapm(prepared, grid);
    expect(cv.best.offence).toBeGreaterThan(10);
    expect(cv.best.offence).toBeLessThan(100000);
    const again = crossValidateRapm(prepareRapmFolds(design, 5, "cv"), grid);
    expect(again.cells.map((c) => c.loss)).toEqual(cv.cells.map((c) => c.loss));
    const searched = searchRapmPenalties(prepared, [100, 400, 1600, 6400], 2);
    expect(searched.cells.length).toBeLessThanOrEqual(4 + 8);
    expect(searched.best.loss).toBeLessThanOrEqual(Math.min(...searched.cells.map((c) => c.loss)));
  });
});

describe("RAPM at realistic size", () => {
  it("solves three seasons' scale (about 1,000 players, 200,000 rows) in seconds", () => {
    // 30 teams × 33 players ≈ 1,000 players; 3 × 1,230 games × 27 stints ≈ 200,000 rows.
    const random = createSeededRandom("scale");
    const options = { seed: "scale", teams: 30, playersPerTeam: 11, meetings: 1, stintsPerGame: 27, possessionsPerStint: 4 };
    const games = [];
    for (const season of [2018, 2019, 2020]) {
      const players = makePlayers(random, options).map((p) => ({ ...p, athleteId: `${season}-${p.athleteId}` }));
      for (let repeat = 0; repeat < 3; repeat += 1) {
        const league = simulateLeague({ ...options, season, seed: `scale-${season}-${repeat}` }, players);
        games.push(...league.games.map((g) => ({ ...g, gameId: `${repeat}-${g.gameId}` })));
      }
    }
    const started = performance.now();
    const design = buildRapmDesign(games);
    const built = performance.now();
    const fit = fitRapm(design, { offence: 2000, defence: 2000 });
    const solved = performance.now();
    expect(design.athleteIds.length).toBe(990);
    expect(design.rowCount).toBeGreaterThan(190_000);
    expect(fit.players.length).toBe(990);
    // Recorded in the build report. Generous bound so a slow CI machine passes.
    console.log(
      `[rapm scale] ${design.athleteIds.length} players, ${design.rowCount} rows: design ${(built - started).toFixed(0)} ms, ` +
        `accumulate + solve ${(solved - built).toFixed(0)} ms`,
    );
    expect(solved - started).toBeLessThan(20_000);
  }, 60_000);
});
