import { describe, expect, it } from "vitest";
import { etDateOf } from "@/lib/season/dates";
import { inGameHomeProbability, secondsRemaining } from "@/lib/season/in-game";
import {
  backToBackFromDates,
  crossCheckStandings,
  decideMissed,
  decideResults,
  decideSeals,
  slateDateAt,
  stuckGames,
  summarizeRecord,
  sealGames,
} from "@/lib/season/live-state";
import { LIVE_MODEL_VERSION, LIVE_PARAMS } from "@/lib/season/params";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { LedgerRow, SealRow, SeasonGame } from "@/lib/season/types";

const [A, B, C, D] = SEASON_TEAMS.map((team) => team.id);

function game(overrides: Partial<SeasonGame> & { id: string; tipUtc: string }): SeasonGame {
  return {
    season: 2027,
    kind: "regular",
    etDate: etDateOf(overrides.tipUtc),
    homeId: A,
    awayId: B,
    neutral: false,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    ...overrides,
  };
}

function seal(gameId: string, overrides: Partial<SealRow> = {}): SealRow {
  return {
    type: "seal",
    gameId,
    etDate: "2026-11-01",
    tipUtc: "2026-11-01T23:00:00Z",
    issuedAt: "2026-11-01T12:00:00Z",
    modelVersion: LIVE_MODEL_VERSION,
    paramsHash: "p",
    ratingsHash: "r",
    homeId: A,
    awayId: B,
    homeWinProbability: 0.6,
    expectedMargin: 3,
    inputsIncomplete: false,
    missingGameIds: [],
    runId: "1",
    market: null,
    ...overrides,
  };
}

describe("slate dates", () => {
  it("keeps a late game on its own slate until 06:00 ET", () => {
    // 03:30 ET on Nov 2 still belongs to the Nov 1 slate.
    expect(slateDateAt("2026-11-02T08:30:00Z")).toBe("2026-11-01");
    // 07:00 ET on Nov 2 has rolled.
    expect(slateDateAt("2026-11-02T12:00:00Z")).toBe("2026-11-02");
  });

  it("uses Eastern dates, not UTC, for evening games", () => {
    const row = game({ id: "1", tipUtc: "2026-11-02T02:00:00Z" });
    expect(row.etDate).toBe("2026-11-01");
  });
});

describe("sealing rule", () => {
  const today = game({ id: "today", tipUtc: "2026-11-01T23:00:00Z" });

  it("does not seal before the window opens", () => {
    const games = [today];
    expect(decideSeals(games, new Set(), "2026-11-01T08:00:00Z")).toEqual([]);
  });

  it("seals once the window opens and earlier games are resolved", () => {
    const yesterday = game({
      id: "y",
      tipUtc: "2026-11-01T02:00:00Z",
      status: "final",
      homeScore: 100,
      awayScore: 90,
    });
    const decisions = decideSeals([yesterday, today], new Set(), "2026-11-01T12:00:00Z");
    expect(decisions.map((row) => row.game.id)).toEqual(["today"]);
    expect(decisions[0].inputsIncomplete).toBe(false);
  });

  it("waits for an unfinished late game from the night before", () => {
    const late = game({ id: "late", tipUtc: "2026-11-01T03:00:00Z", status: "in-progress" });
    expect(decideSeals([late, today], new Set(), "2026-11-01T12:00:00Z")).toEqual([]);
  });

  it("seals inside six hours of tip even if a game is unresolved, and says so", () => {
    const late = game({ id: "late", tipUtc: "2026-11-01T03:00:00Z", status: "in-progress" });
    const decisions = decideSeals([late, today], new Set(), "2026-11-01T18:00:00Z");
    expect(decisions.map((row) => row.game.id)).toEqual(["today"]);
    expect(decisions[0].inputsIncomplete).toBe(true);
    expect(decisions[0].missingGameIds).toEqual(["late"]);
  });

  it("stops blocking on a game stuck for three days and flags it", () => {
    const stuck = game({ id: "stuck", tipUtc: "2026-10-29T23:00:00Z", status: "in-progress" });
    expect(stuckGames([stuck, today], "2026-11-01").map((row) => row.id)).toEqual(["stuck"]);
    const decisions = decideSeals([stuck, today], new Set(), "2026-11-01T12:00:00Z");
    expect(decisions[0].inputsIncomplete).toBe(false);
  });

  it("never seals after tip or twice", () => {
    expect(decideSeals([today], new Set(), "2026-11-01T23:30:00Z")).toEqual([]);
    expect(decideSeals([today], new Set(["today"]), "2026-11-01T12:00:00Z")).toEqual([]);
  });

  it("freezes ratings at the prior date, so same-day results cannot move a seal", () => {
    const earlier = game({
      id: "earlier",
      tipUtc: "2026-10-31T23:00:00Z",
      homeId: C,
      awayId: D,
      status: "final",
      homeScore: 110,
      awayScore: 100,
    });
    const sameDay = game({
      id: "same",
      tipUtc: "2026-11-01T17:00:00Z",
      homeId: C,
      awayId: A,
      status: "final",
      homeScore: 140,
      awayScore: 90,
    });
    const target = game({ id: "target", tipUtc: "2026-11-01T23:30:00Z", homeId: A, awayId: B });
    const context = {
      history: [],
      params: LIVE_PARAMS,
      modelVersion: LIVE_MODEL_VERSION,
      runId: "t",
      nowIso: "2026-11-01T20:00:00Z",
      marketFor: () => null,
    };
    const decision = { game: target, inputsIncomplete: false, missingGameIds: [] };
    const withSameDay = sealGames([decision], {
      ...context,
      seasonGames: [earlier, sameDay, target],
    });
    const withoutSameDay = sealGames([decision], {
      ...context,
      seasonGames: [earlier, { ...sameDay, status: "scheduled", homeScore: null, awayScore: null }, target],
    });
    expect(withSameDay[0].homeWinProbability).toBe(withoutSameDay[0].homeWinProbability);
    expect(withSameDay[0].ratingsHash).toBe(withoutSameDay[0].ratingsHash);
  });

  it("detects a back-to-back from the schedule", () => {
    expect(backToBackFromDates(["2026-10-30", "2026-10-31", "2026-11-01"], "2026-11-01")).toBe(true);
    expect(backToBackFromDates(["2026-10-30", "2026-11-01"], "2026-11-01")).toBe(false);
    expect(backToBackFromDates([], "2026-11-01")).toBe(false);
  });
});

describe("ledger rows", () => {
  it("records a game that tipped unsealed as missed, after the ledger began", () => {
    const sealed = game({ id: "s", tipUtc: "2026-11-01T23:00:00Z" });
    const unsealed = game({ id: "u", tipUtc: "2026-11-02T23:00:00Z", status: "final", homeScore: 1, awayScore: 0 });
    const ledger: LedgerRow[] = [seal("s")];
    const rows = decideMissed([sealed, unsealed], ledger, "2026-11-03T01:00:00Z");
    expect(rows.map((row) => row.gameId)).toEqual(["u"]);
  });

  it("does not count games from before the first seal or postponed games", () => {
    const before = game({ id: "b", tipUtc: "2026-10-31T23:00:00Z", status: "final", homeScore: 1, awayScore: 0 });
    const ghost = game({ id: "g", tipUtc: "2026-11-02T23:00:00Z", status: "postponed" });
    const ledger: LedgerRow[] = [seal("s")];
    expect(decideMissed([before, ghost], ledger, "2026-11-03T01:00:00Z")).toEqual([]);
    expect(decideMissed([before], [], "2026-11-03T01:00:00Z")).toEqual([]);
  });

  it("appends a result once, and again only if the score is corrected", () => {
    const final = game({ id: "s", tipUtc: "2026-11-01T23:00:00Z", status: "final", homeScore: 100, awayScore: 90 });
    const first = decideResults([final], [seal("s")], "2026-11-02T05:00:00Z");
    expect(first).toHaveLength(1);
    const ledger: LedgerRow[] = [seal("s"), ...first];
    expect(decideResults([final], ledger, "2026-11-02T06:00:00Z")).toEqual([]);
    const corrected = { ...final, homeScore: 101 };
    expect(decideResults([corrected], ledger, "2026-11-02T07:00:00Z")).toHaveLength(1);
  });

  it("summarizes the record per version and counts every state", () => {
    const ledger: LedgerRow[] = [
      seal("win", { homeWinProbability: 0.8 }),
      seal("loss", { homeWinProbability: 0.6, inputsIncomplete: true }),
      seal("open", { homeWinProbability: 0.5 }),
      seal("old", { homeWinProbability: 0.9, modelVersion: "older" }),
      { type: "result", gameId: "win", homeScore: 100, awayScore: 90, recordedAt: "x" },
      { type: "result", gameId: "loss", homeScore: 90, awayScore: 100, recordedAt: "x" },
      { type: "result", gameId: "old", homeScore: 90, awayScore: 100, recordedAt: "x" },
      { type: "missed", gameId: "m", etDate: "x", tipUtc: "x", homeId: A, awayId: B, recordedAt: "x" },
    ];
    const record = summarizeRecord(ledger, LIVE_MODEL_VERSION, 0.55);
    expect(record.sealed).toBe(3);
    expect(record.scored).toBe(2);
    expect(record.pending).toBe(1);
    expect(record.missed).toBe(1);
    expect(record.incomplete).toBe(1);
    expect(record.accuracy).toBe(0.5);
    expect(record.brier).toBeCloseTo((0.04 + 0.36) / 2, 9);
    expect(record.smallSample).toBe(true);
  });
});

describe("standings cross-check", () => {
  const today = "2026-11-02";
  const final = game({
    id: "f",
    tipUtc: "2026-11-02T23:30:00Z",
    status: "final",
    homeScore: 100,
    awayScore: 90,
  });
  const baseline = SEASON_TEAMS.map((team) => ({ teamId: team.id, wins: 0, losses: 0 }));

  function espn(overrides: Record<string, { wins: number; losses: number }>) {
    return baseline.map((row) => ({ ...row, ...(overrides[row.teamId] ?? {}) }));
  }

  it("passes when both sides agree", () => {
    const result = crossCheckStandings(
      espn({ [A]: { wins: 1, losses: 0 }, [B]: { wins: 0, losses: 1 } }),
      [final],
      today,
    );
    expect(result).toEqual({ failures: [], lagNotes: [] });
  });

  it("fails hard on the same games played with a different record", () => {
    const result = crossCheckStandings(
      espn({ [A]: { wins: 0, losses: 1 }, [B]: { wins: 1, losses: 0 } }),
      [final],
      today,
    );
    expect(result.failures).toHaveLength(2);
  });

  it("treats ESPN trailing by a recent final as lag, and logs it", () => {
    const result = crossCheckStandings(baseline, [final], today);
    expect(result.failures).toEqual([]);
    expect(result.lagNotes).toHaveLength(2);
  });

  it("fails when ESPN trails by a game outside the recent window", () => {
    const old = { ...final, id: "o", tipUtc: "2026-10-20T23:30:00Z", etDate: "2026-10-20" };
    const result = crossCheckStandings(baseline, [old], today);
    expect(result.failures).toHaveLength(2);
  });

  it("treats ESPN leading by an unfinished recent game as lag only", () => {
    const pending = game({ id: "p", tipUtc: "2026-11-02T23:30:00Z", status: "in-progress" });
    const lagging = crossCheckStandings(
      espn({ [A]: { wins: 1, losses: 0 }, [B]: { wins: 0, losses: 1 } }),
      [pending],
      today,
    );
    expect(lagging.failures).toEqual([]);
    expect(lagging.lagNotes).toHaveLength(2);
    const missing = crossCheckStandings(
      espn({ [A]: { wins: 1, losses: 0 }, [B]: { wins: 0, losses: 1 } }),
      [],
      today,
    );
    expect(missing.failures).toHaveLength(2);
  });
});

describe("in-game estimate", () => {
  const input = { expectedMargin: 2, sigma: 18 };

  it("converts periods and clocks into time remaining", () => {
    expect(secondsRemaining(1, 720)).toBe(2880);
    expect(secondsRemaining(2, 720)).toBe(2160);
    expect(secondsRemaining(4, 30)).toBe(30);
    expect(secondsRemaining(5, 120)).toBe(120);
  });

  it("is the pregame logic at tip and moves with the score", () => {
    const start = inGameHomeProbability({ ...input, homeMargin: 0, period: 1, clockSeconds: 720 });
    const ahead = inGameHomeProbability({ ...input, homeMargin: 10, period: 3, clockSeconds: 720 });
    const behind = inGameHomeProbability({ ...input, homeMargin: -10, period: 3, clockSeconds: 720 });
    expect(start).toBeGreaterThan(0.5);
    expect(start).toBeLessThan(0.6);
    expect(ahead).toBeGreaterThan(0.75);
    expect(behind).toBeLessThan(0.3);
  });

  it("gains certainty as time runs out for the same lead", () => {
    const early = inGameHomeProbability({ ...input, homeMargin: 6, period: 2, clockSeconds: 720 });
    const late = inGameHomeProbability({ ...input, homeMargin: 6, period: 4, clockSeconds: 300 });
    expect(late).toBeGreaterThan(early);
  });

  it("never prints certainty before a game is over", () => {
    const blowout = inGameHomeProbability({ ...input, homeMargin: 45, period: 4, clockSeconds: 5 });
    const collapse = inGameHomeProbability({ ...input, homeMargin: -45, period: 4, clockSeconds: 5 });
    expect(blowout).toBeLessThanOrEqual(0.995);
    expect(collapse).toBeGreaterThanOrEqual(0.005);
  });

  it("keeps a floor of one possession of variance late in a game", () => {
    const final = inGameHomeProbability({ ...input, homeMargin: 1, period: 4, clockSeconds: 1 });
    const minute = inGameHomeProbability({ ...input, homeMargin: 1, period: 4, clockSeconds: 60 });
    expect(final).toBeCloseTo(minute, 9);
    expect(final).toBeLessThan(0.75);
  });

  it("uses the current margin directly in overtime", () => {
    const overtime = inGameHomeProbability({ ...input, homeMargin: 3, period: 5, clockSeconds: 120 });
    expect(overtime).toBeGreaterThan(0.7);
    expect(overtime).toBeLessThan(0.995);
  });
});
