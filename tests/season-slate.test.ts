import { describe, expect, it } from "vitest";
import { LIVE_MODEL_VERSION, LIVE_PARAMS } from "@/lib/season/params";
import { createFilterState, toRatingState } from "@/lib/season/ratings";
import { buildSlateView } from "@/lib/season/slate";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { LiveState, ScoreboardRow, SealRow, SeasonForecast, SeasonGame } from "@/lib/season/types";

const [A, B] = SEASON_TEAMS.map((team) => team.id);
const NOW = "2026-11-01T22:00:00Z";
const DATE = "2026-11-01";

function state(seals: Record<string, SealRow> = {}, generatedAt = "2026-11-01T20:00:00Z"): LiveState {
  return {
    schemaVersion: 1,
    season: 2027,
    seasonLabel: "2026-27",
    modelVersion: LIVE_MODEL_VERSION,
    paramsHash: "p",
    generatedAt,
    scheduleRefreshedEtDate: DATE,
    ratingsThroughUtc: null,
    ratingsHash: "r",
    teamOrder: SEASON_TEAMS.map((team) => team.id),
    ratings: toRatingState(createFilterState(LIVE_PARAMS)),
    teamGameDates: {},
    params: LIVE_PARAMS,
    slateEtDate: DATE,
    nextSlateEtDate: DATE,
    ledgerStartedAt: "2026-11-01T12:00:00Z",
    seals,
    forecast: {} as SeasonForecast,
    record: {} as LiveState["record"],
    history: [],
    notes: [],
  };
}

function row(overrides: Partial<SeasonGame> = {}, live: ScoreboardRow["live"] = null): ScoreboardRow {
  return {
    game: {
      id: "g",
      season: 2027,
      kind: "regular",
      tipUtc: "2026-11-01T23:30:00Z",
      etDate: DATE,
      homeId: A,
      awayId: B,
      neutral: false,
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      ...overrides,
    },
    live,
    statusDetail: "detail",
    market: null,
    homeLinescores: [],
    awayLinescores: [],
    seriesSummary: null,
  };
}

const seal: SealRow = {
  type: "seal",
  gameId: "g",
  etDate: DATE,
  tipUtc: "2026-11-01T23:30:00Z",
  issuedAt: "2026-11-01T12:00:00Z",
  modelVersion: LIVE_MODEL_VERSION,
  paramsHash: "p",
  ratingsHash: "r",
  homeId: A,
  awayId: B,
  homeWinProbability: 0.7,
  expectedMargin: 5,
  inputsIncomplete: false,
  missingGameIds: [],
  runId: "1",
  market: null,
};

function view(rows: ScoreboardRow[] | null, sealed = false, generatedAt?: string) {
  return buildSlateView({
    state: state(sealed ? { g: seal } : {}, generatedAt),
    etDate: DATE,
    nowIso: NOW,
    rows,
    injuries: [],
  });
}

describe("slate view", () => {
  it("shows the sealed number when one exists", () => {
    const game = view([row()], true).games[0];
    expect(game.forecast?.source).toBe("sealed");
    expect(game.forecast?.homeWinProbability).toBe(0.7);
    expect(game.missed).toBe(false);
  });

  it("gives every scheduled game a labeled provisional number if unsealed", () => {
    const game = view([row()]).games[0];
    expect(game.forecast?.source).toBe("provisional");
    expect(game.forecast?.issuedAt).toBeNull();
    expect(game.forecast?.homeWinProbability).toBeGreaterThan(0.5);
  });

  it("marks an unsealed game in progress as missed, with a labeled estimate", () => {
    const game = view([
      row({ status: "in-progress", homeScore: 50, awayScore: 40 }, {
        period: 3,
        clockSeconds: 720,
        display: "Q3",
      }),
    ]).games[0];
    expect(game.missed).toBe(true);
    expect(game.forecast?.source).toBe("provisional");
    expect(game.inGameHomeProbability).toBeGreaterThan(0.5);
  });

  it("does not call a game missed if it tipped before the record began", () => {
    const earlier = row({
      tipUtc: "2026-11-01T01:00:00Z",
      etDate: DATE,
      status: "final",
      homeScore: 100,
      awayScore: 90,
    });
    const game = view([earlier]).games[0];
    expect(game.missed).toBe(false);
    expect(game.beforeRecord).toBe(true);
    const noLedger = buildSlateView({
      state: { ...state(), ledgerStartedAt: null },
      etDate: DATE,
      nowIso: NOW,
      rows: [row({ status: "final", homeScore: 100, awayScore: 90 })],
      injuries: [],
    });
    expect(noLedger.games[0].missed).toBe(false);
    expect(noLedger.games[0].beforeRecord).toBe(true);
  });

  it("shows no number for an unsealed final, since ratings may include the result", () => {
    const game = view([row({ status: "final", homeScore: 100, awayScore: 90 })]).games[0];
    expect(game.forecast).toBeNull();
    expect(game.missed).toBe(true);
    expect(game.sealedFavoriteWon).toBeNull();
  });

  it("uses the sealed margin in-game and scores the favorite at the final", () => {
    const live = view(
      [row({ status: "in-progress", homeScore: 60, awayScore: 60 }, {
        period: 4,
        clockSeconds: 300,
        display: "Q4",
      })],
      true,
    ).games[0];
    expect(live.forecast?.source).toBe("sealed");
    expect(live.inGameHomeProbability).toBeGreaterThan(0.5);

    const won = view([row({ status: "final", homeScore: 100, awayScore: 90 })], true).games[0];
    expect(won.sealedFavoriteWon).toBe(true);
    const lost = view([row({ status: "final", homeScore: 90, awayScore: 100 })], true).games[0];
    expect(lost.sealedFavoriteWon).toBe(false);
  });

  it("falls back to sealed numbers when ESPN is unavailable", () => {
    const result = view(null, true);
    expect(result.scoresAvailable).toBe(false);
    expect(result.games).toHaveLength(1);
    expect(result.games[0].forecast?.source).toBe("sealed");
  });

  it("drops games from other dates and orders by tip", () => {
    const result = view([
      row({ id: "later", tipUtc: "2026-11-02T01:00:00Z" }),
      row({ id: "early", tipUtc: "2026-11-01T17:00:00Z" }),
      row({ id: "other", tipUtc: "2026-11-02T23:00:00Z", etDate: "2026-11-02" }),
    ]);
    expect(result.games.map((game) => game.id)).toEqual(["early", "later"]);
  });

  it("flags published data older than the stale limit", () => {
    expect(view([row()], false, "2026-11-01T20:00:00Z").stale).toBe(false);
    expect(view([row()], false, "2026-10-31T20:00:00Z").stale).toBe(true);
  });
});
