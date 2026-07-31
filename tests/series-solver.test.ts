import { describe, expect, it } from "vitest";

import { solveSeriesExactly } from "@/lib/model/series-solver";

const GAME_PROBABILITIES = [0.61, 0.47, 0.64, 0.43, 0.58, 0.52, 0.69];
const TOLERANCE = 1e-12;

function enumerateSeriesPaths(
  winsA: number,
  winsB: number,
  winsRequired: number,
  probabilityAForGame: (gameNumber: number) => number,
): number {
  if (winsA >= winsRequired) return 1;
  if (winsB >= winsRequired) return 0;

  const probabilityA = probabilityAForGame(winsA + winsB + 1);
  return (
    probabilityA *
      enumerateSeriesPaths(
        winsA + 1,
        winsB,
        winsRequired,
        probabilityAForGame,
      ) +
    (1 - probabilityA) *
      enumerateSeriesPaths(
        winsA,
        winsB + 1,
        winsRequired,
        probabilityAForGame,
      )
  );
}

function reachableScores(winsRequired: number): Array<[number, number]> {
  const scores: Array<[number, number]> = [];
  for (let winsA = 0; winsA <= winsRequired; winsA += 1) {
    for (let winsB = 0; winsB <= winsRequired; winsB += 1) {
      const bothDecided = winsA === winsRequired && winsB === winsRequired;
      if (!bothDecided) scores.push([winsA, winsB]);
    }
  }
  return scores;
}

describe.each([
  { label: "best-of-seven", winsRequired: 4 },
  { label: "best-of-five", winsRequired: 3 },
])("exact series solver: $label", ({ winsRequired }) => {
  it.each(reachableScores(winsRequired))(
    "matches direct path enumeration from %i-%i",
    (winsA, winsB) => {
      const probabilityForGame = (gameNumber: number) =>
        GAME_PROBABILITIES[gameNumber - 1];
      const expected = enumerateSeriesPaths(
        winsA,
        winsB,
        winsRequired,
        probabilityForGame,
      );
      const actual = solveSeriesExactly(
        winsA,
        winsB,
        probabilityForGame,
        winsRequired,
      ).teamAWinProbability;

      expect(Math.abs(actual - expected)).toBeLessThan(TOLERANCE);
    },
  );
});

describe("exact series solver probability invariants", () => {
  it("keeps every probability output inside [0, 1]", () => {
    const solution = solveSeriesExactly(0, 0, (gameNumber) =>
      gameNumber % 2 === 0 ? -0.25 : 1.25,
    );

    expect(solution.teamAWinProbability).toBeGreaterThanOrEqual(0);
    expect(solution.teamAWinProbability).toBeLessThanOrEqual(1);
    for (const probability of Object.values(solution.finalScoreProbabilities)) {
      expect(probability).toBeGreaterThanOrEqual(0);
      expect(probability).toBeLessThanOrEqual(1);
    }
  });

  it("returns 0.5 for equal teams on neutral court at 0-0", () => {
    const probability = solveSeriesExactly(0, 0, () => 0.5)
      .teamAWinProbability;
    expect(Math.abs(probability - 0.5)).toBeLessThan(TOLERANCE);
  });

  it.each(GAME_PROBABILITIES.map((_, index) => index + 1))(
    "is weakly increasing in the game %i win probability",
    (gameNumberToIncrease) => {
      const base = solveSeriesExactly(
        0,
        0,
        (gameNumber) => GAME_PROBABILITIES[gameNumber - 1],
      ).teamAWinProbability;
      const increased = solveSeriesExactly(0, 0, (gameNumber) =>
        gameNumber === gameNumberToIncrease
          ? Math.min(1, GAME_PROBABILITIES[gameNumber - 1] + 0.05)
          : GAME_PROBABILITIES[gameNumber - 1],
      ).teamAWinProbability;

      expect(increased).toBeGreaterThanOrEqual(base - TOLERANCE);
    },
  );

  it("returns exact terminal probabilities for decided series", () => {
    expect(solveSeriesExactly(4, 2, () => 0.61).teamAWinProbability).toBe(1);
    expect(solveSeriesExactly(2, 4, () => 0.61).teamAWinProbability).toBe(0);
  });
});
