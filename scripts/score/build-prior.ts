// Writes data/score/prior-2026.json: every player's rated pieces from the last three
// completed seasons (2023-24 to 2025-26), the past the live 548 score combines with the
// current season (src/lib/score/live.ts). Each piece is rated with its full season's team
// rates and opponent-adjusted net, and the frozen Stage 1 coefficients
// (src/lib/score/params.ts), from the built games under data/historical/raw/score/games/,
// loaded as the registered evaluation loads them (`loadSeasons`, stray teams dropped).
// Deterministic: athletes and pieces in a stable order, fixed decimals.
//
// Run: corepack pnpm exec tsx scripts/score/build-prior.ts
// It never fits, freezes or evaluates anything, and never reads docs/score/ beyond
// checking that fit.json still has the hash the parameters were copied under.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildSeasonTotals, seasonPieceRatings } from "../../src/lib/score/box-model";
import { PRIOR_PIECE_COLUMNS, readScorePrior, storePriorPiece, type ScorePriorFile, type StoredPriorPiece } from "../../src/lib/score/live";
import {
  SCORE_COEFFICIENTS,
  SCORE_FIT_SHA256,
  SCORE_LIVE_SEASON,
  SCORE_MODEL_VERSION,
  SCORE_PRIOR_SEASONS,
} from "../../src/lib/score/params";
import type { ScoreGame } from "../../src/lib/score/types";
import { SCORE_PRIOR_PATH as PRIOR_PATH } from "../live/score-prior";
import { FIT_PATH, loadSeasons } from "./score-data";

/** The prior file from built games of the prior seasons. Pure apart from the games passed in. */
export function buildPrior(games: readonly ScoreGame[]): ScorePriorFile {
  const players = new Map<string, StoredPriorPiece[]>();
  for (const season of SCORE_PRIOR_SEASONS) {
    const ratings = seasonPieceRatings(buildSeasonTotals(games, season), SCORE_COEFFICIENTS);
    if (ratings.length === 0) throw new Error(`no built games for season ${season}`);
    for (const piece of ratings) {
      if (!(piece.possessions > 0)) continue;
      const list = players.get(piece.athleteId) ?? [];
      list.push(storePriorPiece(piece));
      players.set(piece.athleteId, list);
    }
  }
  const sorted: Record<string, StoredPriorPiece[]> = {};
  for (const athleteId of [...players.keys()].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))) {
    sorted[athleteId] = (players.get(athleteId) as StoredPriorPiece[]).sort(
      (a, b) => a[0] - b[0] || a[1].localeCompare(b[1]),
    );
  }
  return {
    version: 1,
    modelVersion: SCORE_MODEL_VERSION,
    fitSha256: SCORE_FIT_SHA256,
    forSeason: SCORE_LIVE_SEASON,
    seasons: [...SCORE_PRIOR_SEASONS],
    columns: PRIOR_PIECE_COLUMNS,
    players: sorted,
  };
}

/** One player per line, so a diff of the file reads. */
export function priorContent(file: ScorePriorFile): string {
  const head = JSON.stringify({ ...file, players: undefined }).slice(0, -1);
  const rows = Object.entries(file.players).map(([athleteId, pieces]) => `${JSON.stringify(athleteId)}:${JSON.stringify(pieces)}`);
  return `${head},"players":{\n${rows.join(",\n")}\n}}\n`;
}

function main(): void {
  const fitHash = createHash("sha256").update(fs.readFileSync(FIT_PATH)).digest("hex");
  if (fitHash !== SCORE_FIT_SHA256) throw new Error(`docs/score/fit.json has hash ${fitHash}, not the frozen ${SCORE_FIT_SHA256}`);
  const games = loadSeasons(SCORE_PRIOR_SEASONS);
  const file = buildPrior(games);
  const content = priorContent(file);
  readScorePrior(JSON.parse(content), SCORE_LIVE_SEASON);
  fs.mkdirSync(path.dirname(PRIOR_PATH), { recursive: true });
  fs.writeFileSync(PRIOR_PATH, content);
  const pieces = Object.values(file.players).reduce((total, list) => total + list.length, 0);
  console.log(
    `[prior] ${path.relative(process.cwd(), PRIOR_PATH)}: ${Object.keys(file.players).length} players, ${pieces} pieces, ` +
      `seasons ${file.seasons.join(", ")}, ${Buffer.byteLength(content)} bytes`,
  );
}

if (process.argv[1]?.endsWith("build-prior.ts")) {
  try {
    main();
  } catch (error) {
    console.error(`[prior] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
