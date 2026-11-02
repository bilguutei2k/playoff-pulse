import { describe, expect, it } from "vitest";
import {
  INJURY_PARAMS,
  INJURY_STATUS_TABLE,
  INJURY_SURVIVAL,
  LIVE_MODEL_VERSION,
  LIVE_PARAMS,
  REFERENCE_MODEL_VERSION,
} from "@/lib/season/params";
import { createFilterState, toRatingState } from "@/lib/season/ratings";
import { buildSlateView } from "@/lib/season/slate";
import { upgradeLiveState } from "@/lib/season/state-schema";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { LiveState, ScoreboardRow, SealRow, SeasonForecast, SeasonGame } from "@/lib/season/types";

const [A, B] = SEASON_TEAMS.map((team) => team.id);
const NOW = "2026-11-01T22:00:00Z";
const DATE = "2026-11-01";

function state(seals: Record<string, SealRow> = {}, generatedAt = "2026-11-01T20:00:00Z"): LiveState {
  return {
    schemaVersion: 2,
    season: 2027,
    seasonLabel: "2026-27",
    modelVersion: LIVE_MODEL_VERSION,
    referenceModelVersion: REFERENCE_MODEL_VERSION,
    paramsHash: "p",
    generatedAt,
    scheduleRefreshedEtDate: DATE,
    ratingsThroughUtc: null,
    ratingsHash: "r",
    teamOrder: SEASON_TEAMS.map((team) => team.id),
    ratings: toRatingState(createFilterState(LIVE_PARAMS)),
    teamGameDates: {},
    params: LIVE_PARAMS,
    injury: { params: INJURY_PARAMS, statusTable: INJURY_STATUS_TABLE, survival: INJURY_SURVIVAL },
    availability: { reportAt: "2026-11-01T16:45", stale: false, missing: false },
    absences: [],
    absencePoints: {},
    currentRatings: {},
    slateEtDate: DATE,
    nextSlateEtDate: DATE,
    ledgerStartedAt: "2026-11-01T12:00:00Z",
    seals: Object.fromEntries(Object.entries(seals).map(([id, row]) => [id, [row]])),
    forecast: {} as SeasonForecast,
    record: {} as LiveState["record"],
    records: {},
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
  modelVersion: REFERENCE_MODEL_VERSION,
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

  it("shows the live market line, vig removed, when the scoreboard has one", () => {
    const withMarket = {
      ...row(),
      market: { provider: "DraftKings", homeMoneyline: -166, awayMoneyline: 140, homeSpread: -3.5 },
    };
    const game = view([withMarket], true).games[0];
    expect(game.market?.provider).toBe("DraftKings");
    expect(game.market?.homeWinProbability).toBeCloseTo(0.5996, 4);
  });

  it("falls back to the market stored with the seal, then to none", () => {
    const sealedMarket: SealRow = {
      ...seal,
      market: { provider: "DraftKings", homeMoneyline: 210, awayMoneyline: -258, homeSpread: 6.5 },
    };
    const live = buildSlateView({
      state: state({ g: sealedMarket }),
      etDate: DATE,
      nowIso: NOW,
      rows: [row({ status: "in-progress", homeScore: 10, awayScore: 8 })],
      injuries: [],
    }).games[0];
    expect(live.market?.homeWinProbability).toBeCloseTo(0.3092, 4);

    // A scoreboard line without both moneylines does not hide the sealed one.
    const spreadOnly = { ...row(), market: { provider: "X", homeMoneyline: null, awayMoneyline: null, homeSpread: -2 } };
    const fallback = buildSlateView({
      state: state({ g: sealedMarket }),
      etDate: DATE,
      nowIso: NOW,
      rows: [spreadOnly],
      injuries: [],
    }).games[0];
    expect(fallback.market?.provider).toBe("DraftKings");

    expect(view([row()], true).games[0].market).toBeNull();
    expect(view([row()]).games[0].market).toBeNull();
  });

  it("keeps the sealed market when ESPN is unavailable", () => {
    const sealedMarket: SealRow = {
      ...seal,
      market: { provider: "DraftKings", homeMoneyline: -110, awayMoneyline: -110, homeSpread: 0 },
    };
    const result = buildSlateView({
      state: state({ g: sealedMarket }),
      etDate: DATE,
      nowIso: NOW,
      rows: null,
      injuries: null,
    });
    expect(result.games[0].market?.homeWinProbability).toBeCloseTo(0.5, 10);
  });

  it("flags published data older than the stale limit", () => {
    expect(view([row()], false, "2026-11-01T20:00:00Z").stale).toBe(false);
    expect(view([row()], false, "2026-10-31T20:00:00Z").stale).toBe(true);
  });
});

const morning: SealRow = {
  ...seal,
  modelVersion: LIVE_MODEL_VERSION,
  sealKind: "morning",
  homeWinProbability: 0.66,
  expectedMargin: 4.2,
  reportAt: "2026-11-01T06:45",
  availabilityStale: false,
  availabilityMissing: false,
  absence: { home: 4, away: 0 },
  absencePoints: { home: 1.6, away: 0 },
  drivers: { home: [{ athleteId: "p1", name: "Paolo Banchero", status: "O", points: 1.6 }], away: [] },
  referenceModelVersion: REFERENCE_MODEL_VERSION,
  referenceHomeWinProbability: 0.7,
};
const final: SealRow = {
  ...morning,
  sealKind: "final",
  issuedAt: "2026-11-01T22:40:00Z",
  homeWinProbability: 0.61,
  reportAt: "2026-11-01T17:30",
  availabilityStale: true,
};

function withRows(rows: SealRow[], overrides: Partial<LiveState> = {}): LiveState {
  return { ...state(), seals: { g: rows }, ...overrides };
}

describe("slate view with two seals", () => {
  it("shows the morning seal with its absences until a final seal exists", () => {
    const game = buildSlateView({ state: withRows([seal, morning]), etDate: DATE, nowIso: NOW, rows: [row()], injuries: [] }).games[0];
    expect(game.forecast?.sealKind).toBe("morning");
    expect(game.forecast?.modelVersion).toBe(LIVE_MODEL_VERSION);
    expect(game.forecast?.homeWinProbability).toBe(0.66);
    expect(game.forecast?.absencePoints).toEqual({ home: 1.6, away: 0 });
    expect(game.forecast?.drivers?.home[0].name).toBe("Paolo Banchero");
    expect(game.forecast?.reportAt).toBe("2026-11-01T06:45");
    expect(game.forecast?.referenceHomeWinProbability).toBe(0.7);
    expect(game.noFinalSeal).toBe(false);
  });

  it("prefers the final seal and carries its report flags", () => {
    const game = buildSlateView({ state: withRows([seal, morning, final]), etDate: DATE, nowIso: NOW, rows: [row()], injuries: [] }).games[0];
    expect(game.forecast?.sealKind).toBe("final");
    expect(game.forecast?.homeWinProbability).toBe(0.61);
    expect(game.forecast?.availabilityStale).toBe(true);
    expect(game.forecast?.reportAt).toBe("2026-11-01T17:30");
  });

  it("labels a game that tipped with only a morning seal as having no final seal", () => {
    const tipped = row({ status: "in-progress", homeScore: 10, awayScore: 8 });
    const without = buildSlateView({ state: withRows([morning]), etDate: DATE, nowIso: NOW, rows: [tipped], injuries: [] }).games[0];
    expect(without.noFinalSeal).toBe(true);
    expect(without.missed).toBe(false);
    const withFinal = buildSlateView({ state: withRows([morning, final]), etDate: DATE, nowIso: NOW, rows: [tipped], injuries: [] }).games[0];
    expect(withFinal.noFinalSeal).toBe(false);
  });

  it("falls back to the v1 seal for a game sealed before v2, without an absence term", () => {
    const game = view([row()], true).games[0];
    expect(game.forecast?.modelVersion).toBe(REFERENCE_MODEL_VERSION);
    expect(game.forecast?.absencePoints).toBeNull();
    expect(game.forecast?.drivers).toBeNull();
    expect(game.noFinalSeal).toBe(false);
  });

  it("applies the published absences to a provisional number and names them", () => {
    const healthy = buildSlateView({ state: state(), etDate: DATE, nowIso: NOW, rows: [row()], injuries: [] }).games[0];
    const hurt = buildSlateView({
      state: {
        ...state(),
        absencePoints: { [A]: 3 },
        absences: [
          { teamId: A, athleteId: "p2", name: "Second Player", status: "Q" as const, reason: "Ankle", class: "short" as const, gamesMissed: 1, expectedGames: 4.73, points: 1 },
          { teamId: A, athleteId: "p1", name: "First Player", status: null, reason: null, class: "long" as const, gamesMissed: 9, expectedGames: 20.81, points: 2 },
        ],
      },
      etDate: DATE,
      nowIso: NOW,
      rows: [row()],
      injuries: [],
    }).games[0];
    expect(hurt.forecast?.source).toBe("provisional");
    expect(hurt.forecast?.homeWinProbability).toBeLessThan(healthy.forecast?.homeWinProbability ?? 0);
    expect(hurt.forecast?.expectedMargin).toBeCloseTo((healthy.forecast?.expectedMargin ?? 0) - 3, 9);
    expect(hurt.forecast?.absencePoints).toEqual({ home: 3, away: 0 });
    expect(hurt.forecast?.drivers?.home.map((driver) => driver.name)).toEqual(["First Player", "Second Player"]);
    expect(hurt.forecast?.reportAt).toBe("2026-11-01T16:45");
    expect(hurt.forecast?.sealKind).toBeNull();
  });

  it("keeps the displayed seal when ESPN is unavailable", () => {
    const result = buildSlateView({ state: withRows([seal, morning, final]), etDate: DATE, nowIso: NOW, rows: null, injuries: null });
    expect(result.games).toHaveLength(1);
    expect(result.games[0].forecast?.sealKind).toBe("final");
    expect(result.modelVersion).toBe(LIVE_MODEL_VERSION);
  });
});

describe("reading a state published before v2", () => {
  const legacy = {
    ...state(),
    schemaVersion: 1,
    modelVersion: REFERENCE_MODEL_VERSION,
    seals: { g: seal },
    forecast: { teams: [{ teamId: A, rating: 2.5 }] } as SeasonForecast,
    record: { modelVersion: REFERENCE_MODEL_VERSION, sealed: 1, scored: 0, pending: 1, missed: 0, incomplete: 0, brier: null, logLoss: null, accuracy: null, baselineBrier: null, smallSample: true },
  } as unknown;

  it("upgrades it to schema 2 and says it has no injury model", () => {
    const upgraded = upgradeLiveState(legacy);
    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.injury).toBeNull();
    expect(upgraded.availability.missing).toBe(true);
    expect(upgraded.seals.g).toEqual([seal]);
    expect(upgraded.records[REFERENCE_MODEL_VERSION].noFinalSeal).toBeNull();
    expect(upgraded.currentRatings[A]).toBe(2.5);
  });

  it("gives a provisional number without an absence term", () => {
    const upgraded = upgradeLiveState(legacy);
    const game = buildSlateView({ state: { ...upgraded, seals: {} }, etDate: DATE, nowIso: NOW, rows: [row()], injuries: [] }).games[0];
    expect(game.forecast?.source).toBe("provisional");
    expect(game.forecast?.absencePoints).toBeNull();
    expect(game.forecast?.availabilityMissing).toBe(false);
  });

  it("rejects an unknown schema", () => {
    expect(() => upgradeLiveState({ schemaVersion: 3 })).toThrow(/schema/);
  });
});
