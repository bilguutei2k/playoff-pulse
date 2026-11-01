import { describe, expect, it } from "vitest";
import { etDateOf } from "@/lib/season/dates";
import { LIVE_PARAMS } from "@/lib/season/params";
import {
  createFilterState,
  predictGame,
  ratingsHash,
  replayRatings,
  rollSeason,
  toRatingState,
  updateWithResult,
} from "@/lib/season/ratings";
import { HCA_INDEX, SEASON_TEAMS, STATE_SIZE, teamIndex } from "@/lib/season/teams";
import type { GameContext, SeasonGame } from "@/lib/season/types";

const A = SEASON_TEAMS[0].id;
const B = SEASON_TEAMS[1].id;
const C = SEASON_TEAMS[2].id;
const D = SEASON_TEAMS[3].id;

function context(overrides: Partial<GameContext> = {}): GameContext {
  return {
    homeId: A,
    awayId: B,
    neutral: false,
    playoff: false,
    homeOnBackToBack: false,
    awayOnBackToBack: false,
    ...overrides,
  };
}

function game(
  id: string,
  dayOffset: number,
  homeId: string,
  awayId: string,
  homeScore: number,
  awayScore: number,
  season = 2027,
): SeasonGame {
  const tipUtc = new Date(Date.UTC(2026, 10, 1 + dayOffset, 23, 0)).toISOString();
  return {
    id,
    season,
    kind: "regular",
    tipUtc,
    etDate: etDateOf(tipUtc),
    homeId,
    awayId,
    neutral: false,
    status: "final",
    homeScore,
    awayScore,
  };
}

describe("rating engine", () => {
  it("rates equal teams on a neutral floor at exactly even", () => {
    const state = createFilterState(LIVE_PARAMS);
    const result = predictGame(state, context({ neutral: true }), LIVE_PARAMS);
    expect(result.expectedMargin).toBe(0);
    expect(result.homeWinProbability).toBeCloseTo(0.5, 12);
  });

  it("gives home court a positive edge", () => {
    const state = createFilterState(LIVE_PARAMS);
    state.mean[HCA_INDEX] = 3;
    expect(predictGame(state, context(), LIVE_PARAMS).homeWinProbability).toBeGreaterThan(0.5);
  });

  it("favors a stronger team and keeps probabilities inside [0, 1]", () => {
    const state = createFilterState(LIVE_PARAMS);
    state.mean[teamIndex(A)] = 40;
    state.mean[teamIndex(B)] = -40;
    const home = predictGame(state, context(), LIVE_PARAMS).homeWinProbability;
    const away = predictGame(state, context({ homeId: B, awayId: A }), LIVE_PARAMS);
    expect(home).toBeGreaterThan(0.99);
    expect(home).toBeLessThanOrEqual(1);
    expect(away.homeWinProbability).toBeLessThan(0.01);
    expect(away.homeWinProbability).toBeGreaterThanOrEqual(0);
  });

  it("penalizes a back-to-back and shifts both sides symmetrically", () => {
    const state = createFilterState(LIVE_PARAMS);
    const fresh = predictGame(state, context({ neutral: true }), LIVE_PARAMS);
    const tiredAway = predictGame(
      state,
      context({ neutral: true, awayOnBackToBack: true }),
      LIVE_PARAMS,
    );
    const tiredHome = predictGame(
      state,
      context({ neutral: true, homeOnBackToBack: true }),
      LIVE_PARAMS,
    );
    expect(tiredAway.expectedMargin - fresh.expectedMargin).toBeCloseTo(LIVE_PARAMS.b2b, 12);
    expect(tiredHome.expectedMargin - fresh.expectedMargin).toBeCloseTo(-LIVE_PARAMS.b2b, 12);
  });

  it("moves the winner up, the loser down, and reduces their uncertainty", () => {
    const state = createFilterState(LIVE_PARAMS);
    const before = state.cov[teamIndex(A) * STATE_SIZE + teamIndex(A)];
    updateWithResult(state, context({ neutral: true }), 12, LIVE_PARAMS);
    expect(state.mean[teamIndex(A)]).toBeGreaterThan(0);
    expect(state.mean[teamIndex(B)]).toBeLessThan(0);
    expect(state.cov[teamIndex(A) * STATE_SIZE + teamIndex(A)]).toBeLessThan(before);
  });

  it("caps blowouts when updating", () => {
    const capped = createFilterState(LIVE_PARAMS);
    const atCap = createFilterState(LIVE_PARAMS);
    updateWithResult(capped, context({ neutral: true }), 70, LIVE_PARAMS);
    updateWithResult(atCap, context({ neutral: true }), LIVE_PARAMS.marginCap, LIVE_PARAMS);
    expect(capped.mean[teamIndex(A)]).toBeCloseTo(atCap.mean[teamIndex(A)], 12);
  });

  it("shrinks ratings toward average and widens uncertainty over the off-season", () => {
    const state = createFilterState(LIVE_PARAMS);
    for (let round = 0; round < 40; round += 1) {
      updateWithResult(state, context({ neutral: true }), 10, LIVE_PARAMS);
    }
    const mean = state.mean[teamIndex(A)];
    const variance = state.cov[teamIndex(A) * STATE_SIZE + teamIndex(A)];
    const homeCourt = state.mean[HCA_INDEX];
    rollSeason(state, LIVE_PARAMS);
    expect(state.mean[teamIndex(A)]).toBeCloseTo(mean * LIVE_PARAMS.rho, 12);
    expect(state.cov[teamIndex(A) * STATE_SIZE + teamIndex(A)]).toBeGreaterThan(variance);
    expect(state.mean[HCA_INDEX]).toBe(homeCourt);
  });
});

describe("G4: no leakage and exact replay", () => {
  const games = [
    game("1", 0, A, B, 110, 100),
    game("2", 1, C, D, 95, 101),
    game("3", 2, A, C, 120, 90),
    game("4", 3, B, D, 99, 105),
    game("5", 4, D, A, 88, 112),
  ];

  it("reproduces state exactly on a repeat replay", () => {
    const first = replayRatings(games, LIVE_PARAMS);
    const second = replayRatings(games, LIVE_PARAMS);
    expect(Array.from(first.state.mean)).toEqual(Array.from(second.state.mean));
    expect(Array.from(first.state.cov)).toEqual(Array.from(second.state.cov));
    expect(ratingsHash(toRatingState(first.state))).toEqual(
      ratingsHash(toRatingState(second.state)),
    );
  });

  it("leaves every earlier forecast byte-identical when a later game changes", () => {
    const original = replayRatings(games, LIVE_PARAMS, { collectPredictions: true });
    const changed = games.map((row) =>
      row.id === "4" ? { ...row, homeScore: 150, awayScore: 70 } : row,
    );
    const altered = replayRatings(changed, LIVE_PARAMS, { collectPredictions: true });
    for (let index = 0; index < 3; index += 1) {
      expect(altered.predictions[index].prediction).toEqual(
        original.predictions[index].prediction,
      );
    }
    // Game 4 itself is unaffected too, because a game never sees its own result.
    expect(altered.predictions[3].prediction).toEqual(original.predictions[3].prediction);
    expect(altered.predictions[4].prediction).not.toEqual(original.predictions[4].prediction);
  });

  it("excludes games an as-of filter rules out, as a seal requires", () => {
    const full = replayRatings(games, LIVE_PARAMS);
    const asOf = replayRatings(games, LIVE_PARAMS, {
      isIncluded: (row) => row.id !== "5",
    });
    const truncated = replayRatings(games.slice(0, 4), LIVE_PARAMS);
    expect(Array.from(asOf.state.mean)).toEqual(Array.from(truncated.state.mean));
    expect(Array.from(asOf.state.mean)).not.toEqual(Array.from(full.state.mean));
  });

  it("ignores postponed and scheduled games", () => {
    const withGhost: SeasonGame[] = [
      ...games,
      { ...game("6", 5, A, B, 0, 0), status: "postponed", homeScore: null, awayScore: null },
      { ...game("7", 6, A, B, 0, 0), status: "scheduled", homeScore: null, awayScore: null },
    ];
    const result = replayRatings(withGhost, LIVE_PARAMS);
    const base = replayRatings(games, LIVE_PARAMS);
    expect(Array.from(result.state.mean)).toEqual(Array.from(base.state.mean));
  });
});
