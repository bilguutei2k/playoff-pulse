// v5 step 1: per-player plus/minus for 2010-11 to 2025-26, the input of v5's on-court
// observation (docs/live/registration-v5.md, observation 3). Regular season only.
//
// Source, read-only: the 548 score's raw store (default
// /Users/bilguutei/dev/548-score/data/historical/raw/score): `summaries/{season}/*.json.gz`
// (ESPN game summaries, whose box scores carry +/-) and `games/{season}.json.gz` (built
// games with stints). Per game: the box score's +/- when both teams' sums equal 5 x the
// team's final margin; else the built game's stints (a player's +/- is the sum over his
// stints of team points minus opponent points), when they exist, were not rejected by their
// own audit and pass the same check; else the game is dropped.
//
// Output: data/season/player-pm/{season}.json.gz ({ season, games: game id -> team id ->
// [athlete id, plus/minus][] }, keys sorted) and docs/live/v5-player-pm-audit.json. Closed
// seasons (2024-25, 2025-26) are built as filter input only and are summarised by counts and
// hashes, nothing else.
//
// Run: corepack pnpm exec tsx scripts/live/v5/build-player-pm.ts [rawDirectory]

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

export const PLAYER_PM_DIRECTORY = "data/season/player-pm";
const FIRST = 2011;
const LAST = 2026;
const CLOSED = new Set([2025, 2026]);
const root = process.cwd();
const rawDirectory = process.argv[2] ?? "/Users/bilguutei/dev/548-score/data/historical/raw/score";

export type PlayerPmFile = { season: number; games: Record<string, Record<string, Array<[string, number]>>> };

type Summary = {
  header: { competitions: Array<{ competitors: Array<{ id: string; score?: string }> }> };
  boxscore: {
    players?: Array<{
      team: { id: string };
      statistics: Array<{ names?: string[]; athletes: Array<{ athlete: { id: string }; stats?: string[]; didNotPlay?: boolean }> }>;
    }>;
  };
};
type Stint = { home: string[]; away: string[]; homePoints: number; awayPoints: number };
type BuiltGame = { gameId: string; homeId: string; awayId: string; stints: Stint[] | null; audit: { rejected?: string | null } };

const sha256 = (buffer: Buffer | string) => createHash("sha256").update(buffer).digest("hex");
const readGz = <T>(file: string): T => JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf-8")) as T;

/** Python's float() on the strings ESPN writes (digits, optional sign and decimals). */
const MINUTES = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)\s*$/;
const PLUS_MINUS = /^\s*[+-]?\d+\s*$/;

function boxPlusMinus(summary: Summary): Map<string, Map<string, number>> {
  const box = new Map<string, Map<string, number>>();
  for (const team of summary.boxscore.players ?? []) {
    const stats = team.statistics[0];
    const names = stats?.names ?? [];
    const ip = names.indexOf("+/-");
    const im = names.indexOf("MIN");
    if (ip < 0 || im < 0) continue;
    const rows = new Map<string, number>();
    for (const athlete of stats.athletes) {
      const s = athlete.stats ?? [];
      if (s.length === 0 || athlete.didNotPlay) continue;
      const rawMinutes = s[im];
      const rawPm = s[ip];
      if (rawMinutes !== "" && rawMinutes !== "--" && !MINUTES.test(rawMinutes)) continue;
      if (rawPm !== "" && rawPm !== "--" && !PLUS_MINUS.test(rawPm.replace("+", ""))) continue;
      const minutes = rawMinutes === "" || rawMinutes === "--" ? 0 : Number(rawMinutes);
      const pm = rawPm === "" || rawPm === "--" ? null : Number(rawPm.replace("+", ""));
      if (minutes > 0 && pm !== null) rows.set(athlete.athlete.id, pm);
    }
    box.set(team.team.id, rows);
  }
  return box;
}

function stintPlusMinus(game: BuiltGame): Map<string, Map<string, number>> {
  const home = new Map<string, number>();
  const away = new Map<string, number>();
  for (const stint of game.stints ?? []) {
    const margin = stint.homePoints - stint.awayPoints;
    for (const id of stint.home) home.set(id, (home.get(id) ?? 0) + margin);
    for (const id of stint.away) away.set(id, (away.get(id) ?? 0) - margin);
  }
  return new Map([
    [game.homeId, home],
    [game.awayId, away],
  ]);
}

/** Both sides present with at least five players and each side's sum equal to 5 x its margin. */
export function passesFiveManCheck(pm: ReadonlyMap<string, ReadonlyMap<string, number>>, score: ReadonlyMap<string, number>): boolean {
  const teams = [...score.keys()];
  return teams.every((teamId) => {
    const rows = pm.get(teamId);
    if (!rows || rows.size < 5) return false;
    const other = teams.find((id) => id !== teamId) as string;
    let sum = 0;
    for (const value of rows.values()) sum += value;
    return sum === 5 * ((score.get(teamId) as number) - (score.get(other) as number));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  fs.mkdirSync(path.join(root, PLAYER_PM_DIRECTORY), { recursive: true });
  const seasons: Record<string, unknown> = {};
  for (let season = FIRST; season <= LAST; season += 1) {
    const built = new Map(readGz<BuiltGame[]>(path.join(rawDirectory, "games", `${season}.json.gz`)).map((game) => [game.gameId, game]));
    const directory = path.join(rawDirectory, "summaries", String(season));
    const files = fs.readdirSync(directory).filter((name) => name.endsWith(".json.gz")).sort();
    const out: PlayerPmFile = { season, games: {} };
    const count = { games: files.length, box: 0, stints: 0, dropped: 0, noScore: 0, playerGames: 0, playerGamesWritten: 0 };
    for (const file of files) {
      const gameId = file.split(".")[0];
      const summary = readGz<Summary>(path.join(directory, file));
      const competitors = summary.header.competitions[0].competitors;
      if (competitors.length !== 2 || !competitors.every((c) => c.score !== undefined)) {
        count.noScore += 1;
        continue;
      }
      const score = new Map(competitors.map((c) => [c.id, Number(c.score)]));
      const box = boxPlusMinus(summary);
      for (const rows of box.values()) count.playerGames += rows.size;
      let pm: Map<string, Map<string, number>> | null = null;
      if (passesFiveManCheck(box, score)) {
        pm = box;
        count.box += 1;
      } else {
        const game = built.get(gameId);
        if (game?.stints && (game.audit.rejected ?? null) === null) {
          const fromStints = stintPlusMinus(game);
          if (passesFiveManCheck(fromStints, score)) {
            pm = fromStints;
            count.stints += 1;
          }
        }
      }
      if (!pm) {
        count.dropped += 1;
        continue;
      }
      const entry: Record<string, Array<[string, number]>> = {};
      for (const teamId of [...pm.keys()].sort()) {
        entry[teamId] = [...(pm.get(teamId) as Map<string, number>)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        count.playerGamesWritten += entry[teamId].length;
      }
      out.games[gameId] = entry;
    }
    const sorted: PlayerPmFile = { season, games: Object.fromEntries(Object.keys(out.games).sort().map((id) => [id, out.games[id]])) };
    const target = path.join(root, PLAYER_PM_DIRECTORY, `${season}.json.gz`);
    const buffer = zlib.gzipSync(JSON.stringify(sorted), { level: 9 });
    fs.writeFileSync(target, buffer);
    const hash = sha256(buffer);
    seasons[String(season)] = CLOSED.has(season)
      ? { closed: true, games: count.games, box: count.box, stints: count.stints, dropped: count.dropped, playerGamesWritten: count.playerGamesWritten, sha256: hash }
      : { ...count, usableShare: Number((count.playerGamesWritten / count.playerGames).toFixed(6)), sha256: hash };
    console.log(`[player-pm] ${season}: ${CLOSED.has(season) ? "closed (counts only)" : JSON.stringify(count)}`);
  }
  const audit = {
    note: "v5 step 1. Regular season only. Source per game: box score +/- when both sides' sums equal 5 x the final margin; else the built game's stints under the same check; else dropped. playerGames: players with minutes and a readable +/- in the box score; playerGamesWritten: player-games in the output (from the box or the stints). Closed seasons are filter input only: counts and hashes, nothing else.",
    rawDirectory,
    seasons,
  };
  fs.writeFileSync(path.join(root, "docs/live/v5-player-pm-audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
}
