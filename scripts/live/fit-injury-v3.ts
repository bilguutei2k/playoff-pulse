// Development seasons ONLY. Does not load held-out names, reports or results.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import type { StoredLine } from "../../src/lib/season/box-scores";
import { absenceClass, resolvePlayer } from "../../src/lib/season/availability";
import { lostValue, type GameAvailability } from "../../src/lib/season/injury-model";
import { fitHazards, stillOut, expectedGamesV3, replayInjuryV3, type HazardObservation } from "../../src/lib/season/injury-v3";
import { INJURY_PARAMS, INJURY_STATUS_TABLE, LIVE_PARAMS } from "../../src/lib/season/params";
import { replayRatings } from "../../src/lib/season/ratings";
import { buildNameIndex, loadBoxScores, loadReports } from "./availability-store";
import { loadHistory, compareGames } from "./game-store";

const seasons = [2022, 2023, 2024];
const stores = [2021, ...seasons].map(loadBoxScores);
const index = buildNameIndex(stores);
const boxes: Record<string, Record<string, StoredLine[]>> = Object.assign({}, ...stores.map((s) => s.games));
const points = new Map<string, GameAvailability>();
for (const season of seasons) {
  const reports = loadReports(season);
  if (!reports) throw new Error(`Missing reports ${season}`);
  for (const [id, game] of Object.entries(reports.games)) {
    const p = game.final;
    points.set(id, { morning: null, final: p && { at: p.at, notSubmitted: p.notSubmitted,
      rows: p.rows.map(([teamId, name, status, reason]) => ({ teamId,
        athleteId: resolvePlayer(index, season, teamId, name), status, reason: reports.reasons[reason] })) } });
  }
}
const games = loadHistory(2024).sort(compareGames);
const gamesById = new Map(games.map((g) => [g.id, g]));
const base = replayRatings(games.filter((g) => g.season < 2021), LIVE_PARAMS).state;
const observations: HazardObservation[] = [];
const open = new Map<string, { missed: number; class: "long" | "short" }>();
let seasonSeen = 0;
let censored = 0;
let completed = 0;
// Every at-risk observation is decided by the NEXT team's game, including returns.
// No observed next game => censor; leaving the expected roster is not a return.
const tracker = replayInjuryV3({ games: [], state: base, stateSeason: 2020, params: LIVE_PARAMS,
  injury: INJURY_PARAMS, statusTable: INJURY_STATUS_TABLE, boxScores: () => undefined,
  availability: () => null }).tracker;
replayInjuryV3({ games: games.filter((g) => g.season >= 2021), state: base, stateSeason: 2020,
  tracker, params: LIVE_PARAMS, injury: INJURY_PARAMS, statusTable: INJURY_STATUS_TABLE,
  boxScores: (id) => {
    const g = gamesById.get(id);
    if (g && g.kind === "regular" && seasons.includes(g.season) &&
        (!boxes[id]?.[g.homeId] || !boxes[id]?.[g.awayId])) {
      for (const key of open.keys()) if ([g.homeId, g.awayId].some((t) => key.startsWith(`${t}:`))) {
        censored++; open.delete(key);
      }
    }
    return boxes[id];
  }, availability: (id) => points.get(id) ?? null,
  onAbsences: (game, teamId, absences) => {
    if (!seasons.includes(game.season) || game.kind !== "regular") return;
    if (game.season !== seasonSeen) { censored += open.size; open.clear(); seasonSeen = game.season; }
    const prefix = `${teamId}:`;
    const appeared = new Set(boxes[game.id][teamId].map((line) => line[0]));
    const absent = new Map(absences.absent.map((a) => [a.athleteId, a]));
    for (const [key, previous] of open) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (appeared.has(id)) {
        observations.push({ ...previous, returned: true }); completed++; open.delete(key);
      } else if (absent.has(id)) {
        observations.push({ ...previous, returned: false });
      } else { censored++; open.delete(key); }
    }
    for (const a of absences.absent) {
      const key = `${prefix}${a.athleteId}`;
      if (!open.has(key) && lostValue(tracker.book, a.athleteId, INJURY_PARAMS) <= 0) continue;
      const row = points.get(game.id)?.final?.rows.find((r) => r.teamId === teamId && r.athleteId === a.athleteId);
      open.set(key, { missed: a.missedBefore + 1, class: absenceClass(row?.reason) });
    }
  },
});
censored += open.size;
const fitted = fitHazards(observations);
const probability = (r: HazardObservation) => 1 - stillOut(fitted.table, r.missed, r.class, 1);
const brier = observations.reduce((s, r) => s + (probability(r) - Number(r.returned)) ** 2, 0) / observations.length;
const logLoss = observations.reduce((s, r) => {
  const p = Math.max(1e-15, Math.min(1 - 1e-15, probability(r)));
  return s - (r.returned ? Math.log(p) : Math.log(1 - p));
}, 0) / observations.length;
const files = [
  ...fs.readdirSync("data/season/games").filter((f) => Number(f.replace('.json', '')) <= 2024).map((f) => `data/season/games/${f}`),
  ...[2021, ...seasons].map((s) => `data/season/boxscores/${s}.json`),
  ...seasons.map((s) => `data/season/reports/${s}.json`),
].sort();
const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const output = {
  version: "live-2026.27-v3", provenance: {
    codeSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    sourceHashes: Object.fromEntries(["scripts/live/fit-injury-v3.ts", "src/lib/season/injury-v3.ts", "src/lib/season/injury-model.ts"].map((f) => [f, sha(f)])),
    warmupSeason: "2020-21", developmentSeasons: ["2021-22", "2022-23", "2023-24"],
    dataHashes: Object.fromEntries(files.map((f) => [f, sha(f)])),
  },
  ...fitted,
  diagnostics: { observations: observations.length, completedSpells: completed, censoredSpells: censored, brier, logLoss,
    expectedFurther: Object.fromEntries((["long", "short"] as const).map((c) => [c, [0, 1, 2, 4, 8, 16, 31].map((k) => expectedGamesV3(fitted.table, k, c))])) },
  limitations: ["In-sample nonparticipation return diagnostics, not medical recovery validation.",
    "Bucket zero has no observations; pooled with one. Constant geometric tail after 31 games.",
    "Rotation exits are censored, not returns; censoring can be informative."],
};
fs.writeFileSync("docs/live/v3-fit.json", JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ ...fitted, diagnostics: output.diagnostics }, null, 2));
