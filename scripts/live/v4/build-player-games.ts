// v4 step 1: compact per-game player lines for 2010-11 to 2025-26, the input of the
// roster-state filter (docs/live/registration-v4.md, M1).
//
// Sources, read-only:
// - regular-season summaries of the 548 score's raw store
//   (/Users/bilguutei/dev/548-score/data/historical/raw/score/games/{season}.json.gz):
//   minutes and the eleven Stage 1 box counts per player;
// - every other game (play-in, playoffs, the Cup final) from data/season/boxscores
//   (2020-21 on), which holds minutes only. Those team-games carry the margin
//   observation with actual minutes and no box observation.
//
// Output: data/season/player-games/{season}.json.gz and the audit
// docs/live/v4-player-games-audit.json (games, team-games without usable lines, hashes).
// Closed seasons (2024-25, 2025-26) are built as filter input only and are summarised
// by those two counts and their hashes, nothing else.
//
// Run: corepack pnpm exec tsx scripts/live/v4/build-player-games.ts [rawDirectory]

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { V4_BOX_STATS } from "../../../src/lib/season/params-v4";
import type { StoredBoxScores } from "../../../src/lib/season/box-scores";
import type { SeasonGame } from "../../../src/lib/season/types";
import { PLAYER_GAMES_DIRECTORY, type PlayerGamesFile, USABLE_TEAM_MINUTES } from "./season-files";

const FIRST = 2011;
const LAST = 2026;
const CLOSED = new Set([2025, 2026]);
const root = process.cwd();
const rawDirectory = process.argv[2] ?? "/Users/bilguutei/dev/548-score/data/historical/raw/score/games";

type RawLine = { athleteId: string; name: string; minutes: number } & Record<string, number | string | boolean | null>;
type RawGame = { gameId: string; season: number; homeId: string; awayId: string; box: Record<string, RawLine[]> };

const sha256 = (buffer: Buffer | string) => createHash("sha256").update(buffer).digest("hex");

fs.mkdirSync(path.join(root, PLAYER_GAMES_DIRECTORY), { recursive: true });
const audit: Record<string, unknown> = {};
const sources: Record<string, string> = {};

for (let season = FIRST; season <= LAST; season += 1) {
  const rawFile = path.join(rawDirectory, `${season}.json.gz`);
  const rawBuffer = fs.readFileSync(rawFile);
  sources[`raw/${season}.json.gz`] = sha256(rawBuffer);
  const raw = JSON.parse(zlib.gunzipSync(rawBuffer).toString("utf-8")) as RawGame[];
  const gamesFile = path.join(root, "data/season/games", `${season}.json`);
  sources[`data/season/games/${season}.json`] = sha256(fs.readFileSync(gamesFile));
  const games = JSON.parse(fs.readFileSync(gamesFile, "utf-8")) as SeasonGame[];
  const finals = games.filter((game) => game.status === "final");
  const boxFile = path.join(root, "data/season/boxscores", `${season}.json`);
  const minutesOnly: StoredBoxScores | null = fs.existsSync(boxFile)
    ? (JSON.parse(fs.readFileSync(boxFile, "utf-8")) as StoredBoxScores)
    : null;
  if (minutesOnly) sources[`data/season/boxscores/${season}.json`] = sha256(fs.readFileSync(boxFile));

  const out: PlayerGamesFile = { season, stats: [...V4_BOX_STATS], names: {}, games: {} };
  const rawById = new Map(raw.map((game) => [game.gameId, game]));
  for (const game of finals) {
    const source = rawById.get(game.id);
    const teams: PlayerGamesFile["games"][string] = {};
    for (const teamId of [game.homeId, game.awayId]) {
      if (source) {
        const lines = (source.box[teamId] ?? []).filter((line) => Number(line.minutes) > 0);
        teams[teamId] = lines.map((line) => {
          out.names[line.athleteId] = line.name;
          return [line.athleteId, Number(line.minutes), ...V4_BOX_STATS.map((stat) => Number(line[stat] ?? 0))];
        });
      } else if (game.kind !== "regular" && minutesOnly?.games[game.id]) {
        const lines = (minutesOnly.games[game.id][teamId] ?? []).filter((line) => line[1] > 0);
        teams[teamId] = lines.map((line) => {
          out.names[line[0]] = minutesOnly.names[line[0]] ?? line[0];
          return [line[0], line[1]];
        });
      } else {
        teams[teamId] = [];
      }
    }
    out.games[game.id] = teams;
  }

  const body = Buffer.from(JSON.stringify(out));
  const compressed = zlib.gzipSync(body, { level: 9 });
  const target = path.join(root, PLAYER_GAMES_DIRECTORY, `${season}.json.gz`);
  fs.writeFileSync(target, compressed);

  let unusable = 0;
  let minutesOnlyTeamGames = 0;
  let unusableRegular = 0;
  for (const game of finals) {
    for (const teamId of [game.homeId, game.awayId]) {
      const lines = out.games[game.id][teamId];
      const minutes = lines.reduce((sum, line) => sum + (line[1] as number), 0);
      if (minutes < USABLE_TEAM_MINUTES) {
        unusable += 1;
        if (game.kind === "regular") unusableRegular += 1;
      } else if (lines.some((line) => line.length === 2)) {
        minutesOnlyTeamGames += 1;
      }
    }
  }
  const entry: Record<string, unknown> = {
    closed: CLOSED.has(season),
    finalGames: finals.length,
    teamGamesWithoutUsableLines: unusable,
    sha256Json: sha256(body),
  };
  if (!CLOSED.has(season)) {
    entry.regularTeamGamesWithoutUsableLines = unusableRegular;
    entry.minutesOnlyTeamGames = minutesOnlyTeamGames;
    entry.regularGamesInRawStore = raw.length;
  }
  audit[String(season)] = entry;
  console.log(`[player-games] ${season}: ${finals.length} games, ${unusable} team-games without usable lines`);
}

const auditFile = path.join(root, "docs/live/v4-player-games-audit.json");
fs.writeFileSync(
  auditFile,
  `${JSON.stringify(
    {
      note:
        "v4 step 1. Team-games without usable lines (team minutes under 200) take the pseudo-player path. " +
        "Closed seasons are filter input only: counts and hashes, nothing else.",
      usableTeamMinutes: USABLE_TEAM_MINUTES,
      stats: V4_BOX_STATS,
      rawDirectory,
      sources,
      seasons: audit,
    },
    null,
    2,
  )}\n`,
  "utf-8",
);
console.log(`[player-games] wrote ${auditFile}`);
