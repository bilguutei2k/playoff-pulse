// In-game validation at quarter ends, the only states with stored truth.
// Default sigma_g is the fitted pregame sigma. On failure the registered rule
// allows one refit on 2025 states only, re-validated on 2026 only.
//
// Run: corepack pnpm exec tsx scripts/live/evaluate-in-game.ts [sigmaG] [--refit]

import * as fs from "node:fs";
import * as path from "node:path";
import { inGameHomeProbability } from "../../src/lib/season/in-game";
import { LIVE_PARAMS } from "../../src/lib/season/params";
import { replayRatings } from "../../src/lib/season/ratings";
import { calibrationFit, logLoss, reliability, round, summarize, type ScoredGame } from "./eval-metrics";
import { compareGames, loadHistory } from "./game-store";

type LinescoreRow = { id: string; home: number[]; away: number[] };

const CHECKPOINTS = [
  { label: "Q1", quarters: 1, period: 2 },
  { label: "Q2", quarters: 2, period: 3 },
  { label: "Q3", quarters: 3, period: 4 },
];
const CLOCK_AT_QUARTER_START = 720;

function loadLinescores(season: number): Map<string, LinescoreRow> {
  const rows = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "data", "season", "linescores", `${season}.json`),
      "utf-8",
    ),
  ) as LinescoreRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

const history = loadHistory(2026).sort(compareGames);
const replay = replayRatings(history, LIVE_PARAMS, { collectPredictions: true });
const expectedById = new Map(
  replay.predictions.map(({ game, prediction, homeWon }) => [
    game.id,
    { game, expectedMargin: prediction.expectedMargin, homeWon },
  ]),
);

function statesFor(
  season: number,
  checkpoint: (typeof CHECKPOINTS)[number],
  sigmaG: number,
): ScoredGame[] {
  const rows: ScoredGame[] = [];
  for (const [id, line] of loadLinescores(season)) {
    const entry = expectedById.get(id);
    if (!entry || entry.game.kind !== "regular") continue;
    let homePoints = 0;
    let awayPoints = 0;
    for (let quarter = 0; quarter < checkpoint.quarters; quarter += 1) {
      homePoints += line.home[quarter] ?? 0;
      awayPoints += line.away[quarter] ?? 0;
    }
    rows.push({
      id: `${id}:${checkpoint.label}`,
      season,
      p: inGameHomeProbability({
        homeMargin: homePoints - awayPoints,
        expectedMargin: entry.expectedMargin,
        period: checkpoint.period,
        clockSeconds: CLOCK_AT_QUARTER_START,
        sigma: sigmaG,
      }),
      y: entry.homeWon ? 1 : 0,
    });
  }
  return rows;
}

function evaluate(seasons: number[], sigmaG: number) {
  return Object.fromEntries(
    CHECKPOINTS.map((checkpoint) => {
      const rows = seasons.flatMap((season) => statesFor(season, checkpoint, sigmaG));
      const summary = summarize(rows);
      const fit = calibrationFit(rows);
      const rel = reliability(rows);
      return [
        checkpoint.label,
        {
          n: summary.n,
          brier: round(summary.brier, 4),
          accuracy: round(summary.accuracy, 4),
          calibrationSlope: round(fit.slope, 3),
          reliability: round(rel),
          passes: rel <= 0.003 && fit.slope >= 0.85 && fit.slope <= 1.15,
        },
      ];
    }),
  );
}

const sigmaG = Number(process.argv[2] ?? LIVE_PARAMS.sigma);
const refit = process.argv.includes("--refit");

if (refit) {
  // Fit on 2025 states only.
  let best = { sigma: sigmaG, loss: Number.POSITIVE_INFINITY };
  for (let sigma = 8; sigma <= 20.001; sigma += 0.25) {
    const rows = CHECKPOINTS.flatMap((checkpoint) => statesFor(2025, checkpoint, sigma));
    const loss = logLoss(rows);
    if (loss < best.loss) best = { sigma, loss };
  }
  console.log(
    JSON.stringify(
      {
        refitOn2025: { sigmaG: best.sigma, logLoss: round(best.loss) },
        validatedOn2026: evaluate([2026], best.sigma),
      },
      null,
      2,
    ),
  );
} else {
  const report = {
    sigmaG,
    seasons: [2025, 2026],
    atQuarterEnds: evaluate([2025, 2026], sigmaG),
  };
  console.log(JSON.stringify(report, null, 2));
}
