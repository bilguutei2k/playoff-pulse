// v4 property tests (registration-v4.md, A6): the filter, the minutes layer and M5.

import { describe, expect, it } from "vitest";
import { createSeededRandom } from "@/lib/model/random";
import { normalCdf } from "@/lib/season/math";
import { createMinutesState, minutesTerms, recordTeamGame, setOpeningRosters } from "@/lib/season/minutes-v4";
import {
  copyRosterState,
  replayRosterState,
  type RosterState,
  type V4ForecastRow,
  type V4GameLines,
  type V4RatingParams,
} from "@/lib/season/roster-state";
import type { ReportPoint } from "@/lib/season/injury-model";
import type { SeasonGame } from "@/lib/season/types";

export const PARAMS: V4RatingParams = {
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
  kappa: 1.3,
};
const STATUS = { O: 0.999, D: 0.98, Q: 0.48, P: 0.19, A: 0.19 };
const TEAMS = ["1", "2", "3", "4"];

/** Two short seasons of four teams, eight players each, with full box lines. */
export function syntheticWorld(seed = "world") {
  const random = createSeededRandom(seed);
  const games: SeasonGame[] = [];
  const lines = new Map<string, V4GameLines>();
  const reports = new Map<string, ReportPoint>();
  for (const season of [2011, 2012]) {
    for (let day = 0; day < 40; day += 1) {
      const date = new Date(Date.UTC(season - 1, 10, 1 + day, 0, 0));
      const etDate = date.toISOString().slice(0, 10);
      const order = [...TEAMS].sort(() => random() - 0.5);
      for (let pair = 0; pair < 2; pair += 1) {
        const [homeId, awayId] = [order[2 * pair], order[2 * pair + 1]];
        const id = `${season}-${day}-${pair}`;
        const homeScore = 95 + Math.floor(random() * 25);
        const awayScore = 95 + Math.floor(random() * 25);
        games.push({
          id,
          season,
          kind: day >= 36 ? "playoff" : "regular",
          tipUtc: `${etDate}T23:${pair}0:00Z`,
          etDate,
          homeId,
          awayId,
          neutral: false,
          status: "final",
          homeScore,
          awayScore: awayScore === homeScore ? awayScore + 1 : awayScore,
        });
        const game: Record<string, Array<[string, number, ...number[]]>> = {};
        for (const teamId of [homeId, awayId]) {
          const players = Array.from({ length: 8 }, (_, index) => `${teamId}-${index}`).filter(
            (_, index) => !(index === 0 && day % 7 === 3),
          );
          const minutes = players.map((_, index) => (index < 5 ? 34 : 70 / 3) + Math.floor(random() * 3));
          const scale = 240 / minutes.reduce((a, b) => a + b, 0);
          game[teamId] = players.map((athleteId, index) => [
            athleteId,
            Math.round(minutes[index] * scale),
            ...Array.from({ length: 11 }, () => Math.floor(random() * 8)),
          ]);
        }
        lines.set(id, game);
        if (season === 2012 && day % 5 === 0) {
          reports.set(id, {
            at: `${etDate}T17:30`,
            notSubmitted: day % 10 === 0 ? [awayId] : [],
            rows: [
              { teamId: homeId, athleteId: `${homeId}-1`, status: "Q", reason: "Injury/Illness - Left Knee; Soreness" },
              { teamId: homeId, athleteId: `${homeId}-2`, status: "O", reason: "Injury/Illness - Right Ankle; Sprain" },
            ],
          });
        }
      }
    }
  }
  return { games, lines, reports };
}

function run(world: ReturnType<typeof syntheticWorld>, extra: Partial<Parameters<typeof replayRosterState>[0]> = {}) {
  const rows: V4ForecastRow[] = [];
  const state = replayRosterState({
    games: world.games,
    linesFor: (id) => world.lines.get(id),
    reportFor: (game) => world.reports.get(game.id) ?? null,
    openingRosters: () => new Map(TEAMS.map((teamId) => [teamId, Array.from({ length: 8 }, (_, index) => `${teamId}-${index}`)])),
    params: PARAMS,
    statusTable: () => STATUS,
    onForecast: (row) => rows.push(row),
    ...extra,
  });
  return { rows, state };
}

const stateDigest = (state: RosterState) =>
  JSON.stringify({
    keys: state.keys,
    mean: Array.from(state.mean.subarray(0, state.n)),
    cov: Array.from({ length: state.n }, (_, row) => Array.from(state.cov.subarray(row * state.capacity, row * state.capacity + state.n))),
    scale: state.scale,
  });

describe("roster-state filter", () => {
  it("changing a later game leaves every earlier forecast byte-identical", () => {
    const world = syntheticWorld();
    const base = run(world);
    const cut = "2011-11-20";
    const changed = syntheticWorld();
    for (const game of changed.games) {
      if (game.etDate >= cut) {
        game.homeScore = (game.homeScore as number) + 30;
        const first = changed.lines.get(game.id) as Record<string, Array<[string, number, ...number[]]>>;
        first[game.homeId][0][2] = 99;
      }
    }
    const after = run(changed);
    const before = (rows: V4ForecastRow[]) => JSON.stringify(rows.filter((row) => row.game.etDate < cut).map((row) => row.forecast));
    expect(before(after.rows)).toBe(before(base.rows));
    expect(JSON.stringify(after.rows)).not.toBe(JSON.stringify(base.rows));
  });

  it("replay from a checkpoint equals replay from the start", () => {
    const world = syntheticWorld();
    let checkpoint: RosterState | null = null;
    const full = run(world, { onDate: (etDate, state) => { if (etDate === "2011-11-25") checkpoint = copyRosterState(state); } });
    expect(checkpoint).not.toBeNull();
    const resumed = run({ ...world, games: world.games.filter((game) => game.etDate > "2011-11-25") }, {
      state: checkpoint as unknown as RosterState,
    });
    expect(stateDigest(resumed.state)).toBe(stateDigest(full.state));
    const late = (rows: V4ForecastRow[]) => JSON.stringify(rows.filter((row) => row.game.etDate > "2011-11-25"));
    expect(late(resumed.rows)).toBe(late(full.rows));
  });

  it("is deterministic and keeps the covariance symmetric", () => {
    const world = syntheticWorld();
    const a = run(world);
    const b = run(syntheticWorld());
    expect(stateDigest(a.state)).toBe(stateDigest(b.state));
    const { state } = a;
    for (let i = 0; i < state.n; i += 1) {
      expect(state.cov[i * state.capacity + i]).toBeGreaterThan(0);
      for (let j = 0; j < i; j += 1) expect(state.cov[i * state.capacity + j]).toBe(state.cov[j * state.capacity + i]);
    }
  });

  it("each side's expected weights sum to 5", () => {
    const { rows } = run(syntheticWorld());
    for (const row of rows) {
      for (const side of [row.forecast.home, row.forecast.away]) {
        expect(side.reduce((sum, [, weight]) => sum + weight, 0)).toBeCloseTo(5, 10);
      }
    }
  });

  it("M5 with nobody Questionable or Doubtful equals the closed form", () => {
    const { rows } = run(syntheticWorld());
    const plain = rows.filter((row) => row.forecast.uncertain === 0);
    expect(plain.length).toBeGreaterThan(100);
    for (const row of plain) {
      expect(row.forecast.components).toHaveLength(1);
      const [{ mu, sd }] = row.forecast.components;
      const closed = Math.min(1 - 1e-6, Math.max(1e-6, normalCdf(mu / (row.forecast.scale * sd))));
      expect(row.forecast.homeWinProbability).toBe(closed);
    }
    const listed = rows.filter((row) => row.forecast.uncertain === 1);
    expect(listed.length).toBeGreaterThan(0);
    for (const row of listed) {
      expect(row.forecast.components).toHaveLength(2);
      expect(row.forecast.components.reduce((sum, component) => sum + component.weight, 0)).toBeCloseTo(1, 12);
    }
  });
});

describe("minutes layer (H3)", () => {
  it("an unlisted player who has missed n games carries at most 0.5^n of his minutes", () => {
    const state = createMinutesState();
    setOpeningRosters(state, new Map([["T", ["a", "b", "c", "d", "e", "f"]]]));
    for (let game = 0; game < 3; game += 1) {
      recordTeamGame(state, 2012, "T", ["a", "b", "c", "d", "e", "f"].map((id) => [id, 40] as [string, number]), [], 0.15);
    }
    for (let n = 1; n <= 8; n += 1) {
      recordTeamGame(state, 2012, "T", ["b", "c", "d", "e", "f"].map((id) => [id, 48] as [string, number]), [], 0.15);
      const term = minutesTerms(state, "T", [], STATUS, 12).find((row) => row.athleteId === "a");
      expect(term?.raw).toBeLessThanOrEqual(40 * 0.5 ** n + 1e-12);
    }
  });

  it("no code path marks a player out without a report row", () => {
    const state = createMinutesState();
    setOpeningRosters(state, new Map([["T", ["a", "b"]]]));
    recordTeamGame(state, 2012, "T", [["b", 48]], [], 0.15);
    const terms = minutesTerms(state, "T", [], STATUS, 12);
    expect(terms.every((term) => term.status === null && term.pOut === null)).toBe(true);
    const listed = minutesTerms(state, "T", [{ athleteId: "a", status: "O", reason: "x" }], STATUS, 12);
    expect(listed.find((term) => term.athleteId === "a")?.status).toBe("O");
  });

  it("a player listed for the previous game and unlisted now takes presence 1", () => {
    const state = createMinutesState();
    setOpeningRosters(state, new Map([["T", ["a", "b"]]]));
    recordTeamGame(state, 2012, "T", [["a", 30], ["b", 30]], [], 0.15);
    recordTeamGame(state, 2012, "T", [["b", 48]], [{ athleteId: "a", status: "O", reason: "x" }], 0.15);
    recordTeamGame(state, 2012, "T", [["b", 48]], [{ athleteId: "a", status: "O", reason: "x" }], 0.15);
    expect(minutesTerms(state, "T", [], STATUS, 12).find((term) => term.athleteId === "a")?.raw).toBe(30);
  });
});
