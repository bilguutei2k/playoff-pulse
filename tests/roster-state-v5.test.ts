// v5 (docs/live/registration-v5.md): roster-state-v5.ts is roster-state.ts plus one marked
// block (observation 3, the on-court plus/minus). These tests keep the copy from drifting,
// show that with s3 off it is v4 exactly, and check the observation's properties.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createSeededRandom } from "@/lib/model/random";
import * as v4 from "@/lib/season/roster-state";
import * as v5 from "@/lib/season/roster-state-v5";
import { V4_FROZEN } from "@/lib/season/params-v4";
import { withOnCourt, type V5OnCourt } from "@/lib/season/params-v5";
import type { SeasonGame } from "@/lib/season/types";
import { devGames, devLinesLookup, devOpeningRosters } from "../scripts/live/v4/dev-data";

const BEGIN = "  // ---- v5 observation 3 (on-court): begin ----";
const END = "  // ---- v5 observation 3 (on-court): end ----";

const PARAMS: v4.V4RatingParams = {
  sigma: 11,
  sBox: 13,
  qP: 0.004,
  qC: 0.006,
  qH: 0.0002,
  rhoP: 0.9,
  qOff: 0.2,
  rhoC: 0.75,
  tauC: 0.8,
  muNew: -1,
  tauNew: 2,
  alpha: 0.15,
  kappa: 1,
};
const STATUS = { O: 0.999, D: 0.98, Q: 0.48, P: 0.19, A: 0.19 };
const TEAMS = ["1", "2", "3", "4"];
const STAR = "1-0";

type PlusMinus = Map<string, Map<string, Map<string, number>>>;

/** Two short regular seasons of four teams with full lines and plus/minus that passes the five-man check. */
function world(seed = "v5-world", starBonus = 0) {
  const random = createSeededRandom(seed);
  const games: SeasonGame[] = [];
  const lines = new Map<string, v4.V4GameLines>();
  const plusMinus: PlusMinus = new Map();
  for (const season of [2011, 2012]) {
    for (let day = 0; day < 40; day += 1) {
      const etDate = new Date(Date.UTC(season - 1, 10, 1 + day)).toISOString().slice(0, 10);
      const order = [...TEAMS].sort(() => random() - 0.5);
      for (let pair = 0; pair < 2; pair += 1) {
        const [homeId, awayId] = [order[2 * pair], order[2 * pair + 1]];
        const id = `${season}-${day}-${pair}`;
        const homeScore = 95 + Math.floor(random() * 25);
        let awayScore = 95 + Math.floor(random() * 25);
        if (awayScore === homeScore) awayScore += 1;
        games.push({ id, season, kind: "regular", tipUtc: `${etDate}T23:${pair}0:00Z`, etDate, homeId, awayId, neutral: false, status: "final", homeScore, awayScore });
        const game: Record<string, Array<[string, number, ...number[]]>> = {};
        const pmGame = new Map<string, Map<string, number>>();
        for (const teamId of [homeId, awayId]) {
          const players = Array.from({ length: 8 }, (_, index) => `${teamId}-${index}`);
          const minutes = players.map((_, index) => (index < 5 ? 34 : 70 / 3));
          const scale = 240 / minutes.reduce((a, b) => a + b, 0);
          const rows = players.map((athleteId, index) => [athleteId, Math.round(minutes[index] * scale), ...Array.from({ length: 11 }, () => Math.floor(random() * 8))] as [string, number, ...number[]]);
          game[teamId] = rows;
          const margin = teamId === homeId ? homeScore - awayScore : awayScore - homeScore;
          const total = rows.reduce((sum, row) => sum + row[1], 0);
          const pm = rows.map((row) => Math.round((5 * margin * row[1]) / total));
          pm[pm.length - 1] += 5 * margin - pm.reduce((a, b) => a + b, 0);
          if (teamId === "1" && starBonus > 0) {
            pm[0] += starBonus;
            for (let index = 1; index <= starBonus; index += 1) pm[index % 7 === 0 ? 7 : index % 7] -= 1;
          }
          pmGame.set(teamId, new Map(rows.map((row, index) => [row[0], pm[index]])));
        }
        lines.set(id, game);
        plusMinus.set(id, pmGame);
      }
    }
  }
  const rosters = (season: number) => new Map(TEAMS.map((teamId) => [teamId, Array.from({ length: 8 }, (_, index) => `${teamId}-${index}`)]));
  return { games, lines, plusMinus, rosters, season: 2012 };
}

function run(engine: typeof v4 | typeof v5, w: ReturnType<typeof world>, params: v4.V4RatingParams) {
  const rows: Array<{ id: string; p: number; components: unknown }> = [];
  const state = (engine.replayRosterState as typeof v4.replayRosterState)({
    games: w.games,
    linesFor: (id) => w.lines.get(id),
    reportFor: () => null,
    openingRosters: w.rosters,
    params,
    statusTable: () => STATUS,
    onForecast: ({ game, forecast }) => rows.push({ id: game.id, p: forecast.homeWinProbability, components: forecast.components }),
  });
  return { rows, state };
}
const lookup = (pm: PlusMinus): V5OnCourt["plusMinus"] => (gameId, teamId) => pm.get(gameId)?.get(teamId) ?? null;
const theta = (state: v4.RosterState, athleteId: string) => state.mean[state.slots.get(`p:${athleteId}`) as number];

describe("roster-state-v5 is roster-state plus one block", () => {
  it("equals roster-state.ts outside the marked block", () => {
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), "src/lib/season", file), "utf-8").split("\n");
    const copy = read("roster-state-v5.ts");
    const begin = copy.indexOf(BEGIN);
    const end = copy.indexOf(END);
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    expect(copy.filter((line) => line === BEGIN || line === END)).toHaveLength(2);
    expect([...copy.slice(0, begin), ...copy.slice(end + 1)]).toEqual(read("roster-state.ts"));
  });
});

describe("s3 off is v4 exactly", () => {
  it("on the synthetic world: v4 parameters, s3 null, and s3 set without plus/minus", () => {
    const w = world();
    const base = run(v4, w, PARAMS);
    for (const params of [PARAMS, withOnCourt(PARAMS, { s3: null, plusMinus: lookup(w.plusMinus) }), withOnCourt(PARAMS, { s3: 30, plusMinus: () => null })]) {
      const other = run(v5, w, params);
      expect(other.rows).toEqual(base.rows);
      expect(Array.from(other.state.mean.subarray(0, other.state.n))).toEqual(Array.from(base.state.mean.subarray(0, base.state.n)));
    }
  });

  it("on a full real season (2010-11, v4's frozen parameters): every forecast identical", () => {
    const games = devGames(2011, 2011);
    const linesFor = devLinesLookup(2011, 2011);
    const input = { games, linesFor, reportFor: () => null, openingRosters: devOpeningRosters, statusTable: () => V4_FROZEN.statusTable };
    const a: number[] = [];
    const b: number[] = [];
    v4.replayRosterState({ ...input, params: V4_FROZEN.ratings, onForecast: ({ forecast }) => a.push(forecast.homeWinProbability) });
    v5.replayRosterState({ ...input, params: withOnCourt(V4_FROZEN.ratings, { s3: null, plusMinus: () => null }), onForecast: ({ forecast }) => b.push(forecast.homeWinProbability) });
    expect(a.length).toBeGreaterThan(1200);
    expect(b).toEqual(a);
  }, 120_000);
});

describe("observation 3 properties", () => {
  it("probabilities are bounded, mixture weights sum to one, and a neutral game's two views sum to one", () => {
    const w = world();
    const { rows, state } = run(v5, w, withOnCourt(PARAMS, { s3: 30, plusMinus: lookup(w.plusMinus) }));
    for (const row of rows) {
      expect(row.p).toBeGreaterThan(0);
      expect(row.p).toBeLessThan(1);
      const weights = (row.components as Array<{ weight: number }>).reduce((sum, c) => sum + c.weight, 0);
      expect(weights).toBeCloseTo(1, 12);
    }
    const game: SeasonGame = { ...w.games[w.games.length - 1], id: "neutral", etDate: "2012-12-30", tipUtc: "2012-12-30T23:00:00Z", neutral: true, status: "scheduled", homeScore: null, awayScore: null };
    const swapped: SeasonGame = { ...game, homeId: game.awayId, awayId: game.homeId };
    const p = v5.forecastGame(v5.copyRosterState(state), game, { home: null, away: null }, PARAMS, STATUS).homeWinProbability;
    const q = v5.forecastGame(v5.copyRosterState(state), swapped, { home: null, away: null }, PARAMS, STATUS).homeWinProbability;
    expect(p + q).toBeCloseTo(1, 12);
  });

  it("two teams of new players on a neutral floor are even", () => {
    const state = v5.createRosterState();
    const rosters = () => new Map([["1", ["a", "b", "c", "d", "e"]], ["2", ["f", "g", "h", "i", "j"]]]);
    v5.advanceTo(state, 2011, "2010-11-01", PARAMS, rosters);
    const game: SeasonGame = { id: "even", season: 2011, kind: "regular", tipUtc: "2010-11-01T23:00:00Z", etDate: "2010-11-01", homeId: "1", awayId: "2", neutral: true, status: "scheduled", homeScore: null, awayScore: null };
    expect(v5.forecastGame(state, game, { home: null, away: null }, PARAMS, STATUS).homeWinProbability).toBeCloseTo(0.5, 12);
  });

  it("a player whose team does better with him on than off ends rated above the same replay without the observation", () => {
    const w = world("v5-world", 8);
    const off = run(v5, w, withOnCourt(PARAMS, { s3: null, plusMinus: lookup(w.plusMinus) }));
    const on = run(v5, w, withOnCourt(PARAMS, { s3: 20, plusMinus: lookup(w.plusMinus) }));
    expect(theta(on.state, STAR)).toBeGreaterThan(theta(off.state, STAR) + 0.1);
  });

  it("a game failing the five-man check contributes no observation", () => {
    const w = world("v5-world", 8);
    const broken: PlusMinus = new Map(
      [...w.plusMinus].map(([gameId, teams]) => [gameId, new Map([...teams].map(([teamId, rows]) => [teamId, new Map([...rows].map(([id, pm], index) => [id, index === 0 ? pm + 1 : pm]))]))]),
    );
    const off = run(v5, w, withOnCourt(PARAMS, { s3: null, plusMinus: lookup(w.plusMinus) }));
    const failing = run(v5, w, withOnCourt(PARAMS, { s3: 20, plusMinus: lookup(broken) }));
    expect(failing.rows).toEqual(off.rows);
    expect(Array.from(failing.state.mean.subarray(0, failing.state.n))).toEqual(Array.from(off.state.mean.subarray(0, off.state.n)));
  });
});
