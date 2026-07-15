import { clampProbability } from "@/lib/model/probability";

export type ExactSeriesSolution = {
  teamAWinProbability: number;
  expectedGamesRemaining: number;
  finalScoreProbabilities: Record<string, number>;
};

type StateResult = ExactSeriesSolution;

/** Exact dynamic-programming solver for a best-of-seven from any valid score. */
export function solveSeriesExactly(
  winsA: number,
  winsB: number,
  probabilityAForGame: (gameNumber: number) => number,
): ExactSeriesSolution {
  const memo = new Map<string, StateResult>();

  function solve(a: number, b: number): StateResult {
    const key = `${a}-${b}`;
    const cached = memo.get(key);
    if (cached) return cached;
    if (a >= 4 || b >= 4) {
      return {
        teamAWinProbability: a >= 4 ? 1 : 0,
        expectedGamesRemaining: 0,
        finalScoreProbabilities: { [key]: 1 },
      };
    }

    const probabilityA = clampProbability(probabilityAForGame(a + b + 1));
    const win = solve(a + 1, b);
    const loss = solve(a, b + 1);
    const finalScoreProbabilities: Record<string, number> = {};
    for (const [score, probability] of Object.entries(win.finalScoreProbabilities)) {
      finalScoreProbabilities[score] =
        (finalScoreProbabilities[score] ?? 0) + probabilityA * probability;
    }
    for (const [score, probability] of Object.entries(loss.finalScoreProbabilities)) {
      finalScoreProbabilities[score] =
        (finalScoreProbabilities[score] ?? 0) + (1 - probabilityA) * probability;
    }

    const result = {
      teamAWinProbability: clampProbability(
        probabilityA * win.teamAWinProbability +
          (1 - probabilityA) * loss.teamAWinProbability,
      ),
      expectedGamesRemaining:
        1 +
        probabilityA * win.expectedGamesRemaining +
        (1 - probabilityA) * loss.expectedGamesRemaining,
      finalScoreProbabilities,
    };
    memo.set(key, result);
    return result;
  }

  return solve(winsA, winsB);
}
