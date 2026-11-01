// The one permitted G3 fix: re-fit `sigma` alone on 2010-2015 regular seasons,
// with every other parameter held at its registered value. Loads no season
// after 2015. See docs/live/registration.md.
//
// Run: corepack pnpm exec tsx scripts/live/refit-sigma.ts

import { LIVE_PARAMS } from "../../src/lib/season/params";
import { replayRatings } from "../../src/lib/season/ratings";
import { logLoss, round, type ScoredGame } from "./eval-metrics";
import { compareGames, loadHistory } from "./game-store";

const games = loadHistory(2015).sort(compareGames);
const scored = new Set(
  games
    .filter((game) => game.season >= 2010 && game.kind === "regular")
    .map((game) => game.id),
);

const results: Array<{ sigma: number; logLoss: number }> = [];
for (let sigma = 9; sigma <= 16.001; sigma += 0.25) {
  const params = { ...LIVE_PARAMS, sigma };
  const rows: ScoredGame[] = replayRatings(games, params, {
    collectPredictions: true,
  })
    .predictions.filter(({ game }) => scored.has(game.id))
    .map(({ game, prediction, homeWon }) => ({
      id: game.id,
      season: game.season,
      p: prediction.homeWinProbability,
      y: homeWon ? 1 : 0,
    }));
  results.push({ sigma, logLoss: round(logLoss(rows)) });
}
const best = results.reduce((a, b) => (b.logLoss < a.logLoss ? b : a));
console.log(JSON.stringify({ n: scored.size, best, results }));
