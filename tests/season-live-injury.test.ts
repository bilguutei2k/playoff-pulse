import { describe, expect, it } from "vitest";
import type { StoredLine } from "@/lib/season/box-scores";
import { etDateOf } from "@/lib/season/dates";
import { createTracker, expectedAbsence, recordPlayerGame, type ReportPoint } from "@/lib/season/injury-model";
import {
  absenceDetail,
  applyLatestReport,
  nextGameAbsenceDetail,
  forgetEarlierSeasonReports,
  injuryModelHash,
  pendingRegularGames,
  publishAbsences,
  replayFullStrength,
  seasonAvailability,
  sealInjuryGames,
  type InjuryModel,
  type InjurySealContext,
} from "@/lib/season/live-injury";
import { sealGames } from "@/lib/season/live-state";
import {
  INJURY_PARAMS,
  INJURY_STATUS_TABLE,
  INJURY_SURVIVAL,
  LIVE_MODEL_VERSION,
  LIVE_PARAMS,
  REFERENCE_MODEL_VERSION,
} from "@/lib/season/params";
import { predictGame, replayRatings, toRatingState } from "@/lib/season/ratings";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { SeasonGame } from "@/lib/season/types";

const MODEL: InjuryModel = {
  params: LIVE_PARAMS,
  injury: INJURY_PARAMS,
  statusTable: INJURY_STATUS_TABLE,
  survival: INJURY_SURVIVAL,
};
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

/** A month of A against B with box scores, plus C against D without any. */
function season(): { games: SeasonGame[]; box: Map<string, Record<string, StoredLine[]>> } {
  const games: SeasonGame[] = [];
  const box = new Map<string, Record<string, StoredLine[]>>();
  for (let day = 0; day < 20; day += 1) {
    const date = new Date(Date.UTC(2026, 9, 21 + day, 23, 30)).toISOString();
    const id = `ab-${day}`;
    const starPlays = day < 15;
    games.push(game({ id, tipUtc: date, status: "final", homeScore: 105 + (day % 3), awayScore: 100 }));
    box.set(id, {
      [A]: starPlays
        ? [["a-star", 36, 26], ["a-wing", 30, 12]]
        : [["a-wing", 34, 13], ["a-sub", 20, 5]],
      [B]: [["b-star", 35, 22], ["b-wing", 30, 11]],
    });
    games.push(
      game({ id: `cd-${day}`, tipUtc: date, homeId: C, awayId: D, status: "final", homeScore: 99, awayScore: 101 }),
    );
  }
  return { games, box };
}

function context(overrides: Partial<InjurySealContext> = {}): InjurySealContext {
  const { games, box } = season();
  return {
    history: [],
    seasonGames: games,
    model: MODEL,
    modelVersion: LIVE_MODEL_VERSION,
    referenceModelVersion: REFERENCE_MODEL_VERSION,
    runId: "t",
    nowIso: "2026-11-12T23:00:00Z",
    source: { boxScores: (id) => box.get(id), availability: () => null },
    report: { point: null, stale: false, missing: false },
    nameOf: (id) => `Name ${id}`,
    marketFor: () => null,
    ...overrides,
  };
}

const point = (rows: Array<[string, string, "O" | "D" | "Q" | "P" | "A"]>): ReportPoint => ({
  at: "2026-11-12T17:30",
  notSubmitted: [],
  rows: rows.map(([teamId, athleteId, status]) => ({ teamId, athleteId, status, reason: "Injury/Illness - Knee" })),
});

describe("full-strength replay", () => {
  it("matches v1's plain replay exactly when no box score exists", () => {
    const { games } = season();
    const none = { boxScores: () => undefined, availability: () => null };
    const full = replayFullStrength(games, MODEL, none, { asOfEtDate: "2026-11-12" });
    const plain = replayRatings(games, LIVE_PARAMS, { asOfEtDate: "2026-11-12" });
    expect(toRatingState(full.state)).toEqual(toRatingState(plain.state));
    expect(full.lastGameEtDate).toEqual(plain.lastGameEtDate);
    expect(full.ratingsThroughUtc).toBe(plain.ratingsThroughUtc);
    const frozen = replayFullStrength(games, MODEL, none, { throughEtDate: "2026-11-05" });
    const frozenPlain = replayRatings(games, LIVE_PARAMS, {
      isIncluded: (row) => row.etDate < "2026-11-05",
      asOfEtDate: "2026-11-05",
    });
    expect(toRatingState(frozen.state)).toEqual(toRatingState(frozenPlain.state));
  });

  it("credits a team for results without its star once box scores exist", () => {
    const { games, box } = season();
    const full = replayFullStrength(games, MODEL, { boxScores: (id) => box.get(id), availability: () => null }, { asOfEtDate: "2026-11-12" });
    const plain = replayRatings(games, LIVE_PARAMS, { asOfEtDate: "2026-11-12" });
    const index = SEASON_TEAMS.findIndex((team) => team.id === A);
    expect(full.state.mean[index]).toBeGreaterThan(plain.state.mean[index]);
  });

  it("refuses two cut-offs at once", () => {
    expect(() =>
      replayFullStrength([], MODEL, { boxScores: () => undefined, availability: () => null }, { asOfEtDate: "x", throughEtDate: "y" }),
    ).toThrow();
  });
});

describe("absence detail", () => {
  it("sums its drivers to the engine's expected absence, largest first", () => {
    const tracker = createTracker();
    for (let index = 0; index < 20; index += 1) {
      recordPlayerGame(tracker.book, A, [["star", 36, 25], ["role", 25, 10], ["scrub", 10, 1]], INJURY_PARAMS);
    }
    const report = point([[A, "role", "Q"], [A, "star", "O"], [A, "scrub", "O"], [B, "other", "O"]]);
    const detail = absenceDetail(report, A, tracker, MODEL, (id) => id.toUpperCase());
    expect(detail.absence).toBe(expectedAbsence(report, A, tracker.book, INJURY_STATUS_TABLE, INJURY_PARAMS));
    expect(detail.drivers.map((driver) => driver.name)).toEqual(["STAR", "ROLE"]);
    const total = detail.drivers.reduce((sum, driver) => sum + driver.points, 0);
    expect(total).toBeCloseTo(INJURY_PARAMS.beta * detail.absence, 12);
    expect(absenceDetail(null, A, tracker, MODEL, (id) => id)).toEqual({ absence: 0, drivers: [] });
  });
});

describe("v2 seals", () => {
  const target = game({ id: "target", tipUtc: "2026-11-13T00:30:00Z" });
  const decision = { game: target, inputsIncomplete: false, missingGameIds: [], kind: "final" as const };

  it("prices from ratings frozen at the previous ET date", () => {
    const base = context();
    const sameDay = game({ id: "same", tipUtc: "2026-11-12T17:00:00Z", homeId: C, awayId: A, status: "final", homeScore: 150, awayScore: 80 });
    const withSameDay = sealInjuryGames([decision], { ...base, seasonGames: [...base.seasonGames, sameDay, target] })[0];
    const without = sealInjuryGames([decision], {
      ...base,
      seasonGames: [...base.seasonGames, { ...sameDay, status: "scheduled", homeScore: null, awayScore: null }, target],
    })[0];
    expect(withSameDay.homeWinProbability).toBe(without.homeWinProbability);
    expect(withSameDay.ratingsHash).toBe(without.ratingsHash);
  });

  it("recomputes v1's number from v1's own replay at the same instant", () => {
    const base = context({ seasonGames: [...context().seasonGames, target] });
    const row = sealInjuryGames([decision], base)[0];
    const v1 = sealGames([decision], {
      history: [],
      seasonGames: base.seasonGames,
      params: LIVE_PARAMS,
      modelVersion: REFERENCE_MODEL_VERSION,
      runId: "t",
      nowIso: base.nowIso,
      marketFor: () => null,
    })[0];
    expect(row.referenceHomeWinProbability).toBe(v1.homeWinProbability);
    expect(row.referenceModelVersion).toBe(REFERENCE_MODEL_VERSION);
    expect(row.modelVersion).toBe(LIVE_MODEL_VERSION);
    expect(row.policyRevision).toBe(3);
  });

  it("stores the kind, the report, the absence term and every driver", () => {
    const base = context({ seasonGames: [...context().seasonGames, target] });
    const report = point([[A, "a-star", "O"], [A, "a-wing", "Q"], [A, "a-sub", "D"], [A, "nobody", "O"], [B, "b-star", "D"]]);
    const healthy = sealInjuryGames([decision], base)[0];
    const row = sealInjuryGames([decision], { ...base, report: { point: report, stale: true, missing: false } })[0];
    expect(row.sealKind).toBe("final");
    expect(row.reportAt).toBe("2026-11-12T17:30");
    expect(row.availabilityStale).toBe(true);
    expect(row.availabilityMissing).toBe(false);
    expect(row.absence?.home).toBeGreaterThan(row.absence?.away ?? Infinity);
    expect(row.absencePoints?.home).toBeCloseTo(INJURY_PARAMS.beta * (row.absence?.home ?? 0), 2);
    expect(row.driversComplete).toBe(true);
    expect(row.unfiled).toEqual({ home: false, away: false });
    expect(row.drivers?.home.map((driver) => driver.athleteId)).toEqual(["a-star", "a-wing", "a-sub"]);
    expect(row.drivers?.home[0].name).toBe("Name a-star");
    expect(row.drivers?.away.map((driver) => driver.status)).toEqual(["D"]);
    expect(row.homeWinProbability).toBeLessThan(healthy.homeWinProbability);
    expect(row.referenceHomeWinProbability).toBe(healthy.referenceHomeWinProbability);
  });

  it("seals with no absences, and says so, when availability is missing", () => {
    const base = context({ seasonGames: [...context().seasonGames, target] });
    const report = point([[A, "a-star", "O"]]);
    const row = sealInjuryGames([{ ...decision, kind: "morning" }], { ...base, report: { point: report, stale: false, missing: true } })[0];
    expect(row.sealKind).toBe("morning");
    expect(row.availabilityMissing).toBe(true);
    expect(row.reportAt).toBeNull();
    expect(row.absence).toEqual({ home: 0, away: 0 });
    expect(row.drivers).toEqual({ home: [], away: [] });
    expect(row.unfiled).toEqual({ home: false, away: false });
  });

  it("changes its parameter hash with any frozen input", () => {
    expect(injuryModelHash(MODEL)).not.toBe(injuryModelHash({ ...MODEL, injury: { ...INJURY_PARAMS, beta: 0.5 } }));
    expect(injuryModelHash(MODEL)).toBe(injuryModelHash({ ...MODEL }));
  });
});

describe("season availability", () => {
  it("counts pending regular games as the simulator orders them", () => {
    const pending = pendingRegularGames([
      game({ id: "1", tipUtc: "2026-11-12T23:00:00Z" }),
      game({ id: "2", tipUtc: "2026-11-13T23:00:00Z", status: "in-progress" }),
      game({ id: "3", tipUtc: "2026-11-11T23:00:00Z", status: "final", homeScore: 1, awayScore: 0 }),
      game({ id: "4", tipUtc: "2026-11-14T23:00:00Z", status: "postponed" }),
      game({ id: "5", tipUtc: "2026-11-15T23:00:00Z", kind: "cup-final" }),
    ]);
    expect(pending[A]).toBe(2);
    expect(pending[B]).toBe(2);
    expect(pending[C]).toBe(0);
  });

  it("uses the run's report only for the teams it is given", () => {
    const tracker = createTracker();
    tracker.latestRows.set(C, [{ teamId: C, athleteId: "old", status: "O", reason: "" }]);
    applyLatestReport(tracker, point([[A, "x", "O"], [C, "new", "O"]]), [A]);
    expect(tracker.latestRows.get(A)?.map((row) => row.athleteId)).toEqual(["x"]);
    expect(tracker.latestRows.get(C)?.map((row) => row.athleteId)).toEqual(["old"]);
    applyLatestReport(tracker, null, [C]);
    expect(tracker.latestRows.get(C)?.map((row) => row.athleteId)).toEqual(["old"]);
  });

  it("charges a listed-out player to his team's next games, and names him", () => {
    const { games, box } = season();
    const replay = replayFullStrength(games, MODEL, { boxScores: (id) => box.get(id), availability: () => null }, { asOfEtDate: "2026-11-12" });
    applyLatestReport(replay.tracker, point([[B, "b-star", "O"]]), [B]);
    const upcoming = [...games, game({ id: "next", tipUtc: "2026-11-13T00:30:00Z" })];
    const availability = seasonAvailability(replay.tracker, MODEL, upcoming);
    const ids = availability.current.map((row) => `${row.teamId}:${row.athleteId}`);
    // A's star has missed the last five games; B's is listed out.
    expect(ids).toContain(`${A}:a-star`);
    expect(ids).toContain(`${B}:b-star`);
    expect(availability.absencePoints[A]).toBeGreaterThan(0);
    expect(availability.absencePoints[B]).toBeGreaterThan(0);
    expect(availability.absencePoints[C]).toBe(0);
    expect(availability.simulation.regular[A]).toHaveLength(1);
    const published = publishAbsences(availability.current, replay.tracker, (id) => `Name ${id}`);
    const bStar = published.find((row) => row.athleteId === "b-star");
    expect(bStar).toMatchObject({ teamId: B, name: "Name b-star", status: "O", reason: "Injury/Illness - Knee" });
    const aStar = published.find((row) => row.athleteId === "a-star");
    expect(aStar?.status).toBeNull();
    expect(aStar?.gamesMissed).toBe(5);
    for (const row of published) expect(row.points).toBeGreaterThan(0);
  });
});

describe("reports from an earlier season", () => {
  it("are forgotten for teams with no report this season", () => {
    const tracker = createTracker();
    tracker.latestRows.set(A, [{ teamId: A, athleteId: "april", status: "O", reason: "" }]);
    tracker.latestRows.set(C, [{ teamId: C, athleteId: "march", status: "O", reason: "" }]);
    const played = game({ id: "p", tipUtc: "2026-11-01T23:00:00Z", homeId: A, awayId: B, status: "final", homeScore: 1, awayScore: 0 });
    const report = point([[A, "april", "O"]]);
    forgetEarlierSeasonReports(tracker, [played], {
      boxScores: (id) => (id === "p" ? { [A]: [["x", 30, 10]], [B]: [["y", 30, 10]] } : undefined),
      availability: (id) => (id === "p" ? { morning: null, final: report } : null),
    });
    expect(tracker.latestRows.has(A)).toBe(true);
    expect(tracker.latestRows.has(C)).toBe(false);
  });
});

describe("unfiled sides", () => {
  const target = game({ id: "target", tipUtc: "2026-11-13T00:30:00Z" });
  const decision = (kind: "morning" | "reissued" | "final") => ({
    game: target,
    inputsIncomplete: false,
    missingGameIds: [],
    kind,
  });
  // A has not filed; B has, listing its star doubtful.
  const unfiledA: ReportPoint = { ...point([[B, "b-star", "D"]]), notSubmitted: [A] };

  it("charge the team's current absences, exactly as the season simulation charges its next game", () => {
    const base = context({ seasonGames: [...context().seasonGames, target] });
    const row = sealInjuryGames([decision("final")], { ...base, report: { point: unfiledA, stale: false, missing: false } })[0];
    expect(row.unfiled).toEqual({ home: true, away: false });
    // A's star missed the last five games and A has not said otherwise.
    expect(row.drivers?.home.map((driver) => [driver.athleteId, driver.status])).toEqual([["a-star", null]]);
    // What the published state would charge A for this game, from the same report.
    const { games, box } = season();
    const source = { boxScores: (id: string) => box.get(id), availability: () => null };
    const frozen = replayFullStrength([...games, target], MODEL, source, { throughEtDate: target.etDate });
    applyLatestReport(frozen.tracker, unfiledA, [A, B]);
    const charged = seasonAvailability(frozen.tracker, MODEL, [...games, target]).absencePoints[A];
    expect(charged).toBeGreaterThan(1);
    expect(row.absencePoints?.home).toBeCloseTo(charged, 3);
    expect(row.absence?.home).toBeCloseTo(charged / INJURY_PARAMS.beta, 4);
    // B's side keeps the report rule.
    const filed = expectedAbsence(unfiledA, B, frozen.tracker.book, INJURY_STATUS_TABLE, INJURY_PARAMS);
    expect(row.absence?.away).toBeCloseTo(filed, 4);
  });

  it("apply to morning, reissued and final seals alike", () => {
    const base = context({ seasonGames: [...context().seasonGames, target] });
    const report = { point: unfiledA, stale: false, missing: false };
    const rows = (["morning", "reissued", "final"] as const).map(
      (kind) => sealInjuryGames([decision(kind)], { ...base, report })[0],
    );
    for (const row of rows) {
      expect(row.unfiled).toEqual({ home: true, away: false });
      expect(row.absencePoints).toEqual(rows[2].absencePoints);
      expect(row.homeWinProbability).toBe(rows[2].homeWinProbability);
    }
    expect(rows.map((row) => row.sealKind)).toEqual(["morning", "reissued", "final"]);
  });

  it("are not a team that is simply absent from the report, which has nobody listed", () => {
    const base = context({ seasonGames: [...context().seasonGames, target] });
    const absent = sealInjuryGames([decision("final")], {
      ...base,
      report: { point: point([[B, "b-star", "D"]]), stale: false, missing: false },
    })[0];
    expect(absent.unfiled).toEqual({ home: false, away: false });
    expect(absent.absence?.home).toBe(0);
    expect(absent.drivers?.home).toEqual([]);
    const unfiled = sealInjuryGames([decision("final")], { ...base, report: { point: unfiledA, stale: false, missing: false } })[0];
    expect(unfiled.homeWinProbability).toBeLessThan(absent.homeWinProbability);
    expect(unfiled.referenceHomeWinProbability).toBe(absent.referenceHomeWinProbability);
  });

  it("leave the tracker as it was", () => {
    const tracker = createTracker();
    tracker.latestRows.set(A, [{ teamId: A, athleteId: "old", status: "O", reason: "" }]);
    nextGameAbsenceDetail(unfiledA, A, tracker, MODEL, (id) => id);
    expect(tracker.latestRows.get(A)?.map((row) => row.athleteId)).toEqual(["old"]);
  });
});

describe("complete drivers", () => {
  // Five rotation players a side, all playing every game.
  const rotation = (team: string): StoredLine[] =>
    [36, 32, 28, 24, 20].map((minutes, index) => [`${team}-${index}`, minutes, 20 - index * 3]);
  function deep(): { games: SeasonGame[]; box: Map<string, Record<string, StoredLine[]>> } {
    const games: SeasonGame[] = [];
    const box = new Map<string, Record<string, StoredLine[]>>();
    for (let day = 0; day < 20; day += 1) {
      const tipUtc = new Date(Date.UTC(2026, 9, 21 + day, 23, 30)).toISOString();
      games.push(game({ id: `d-${day}`, tipUtc, status: "final", homeScore: 104, awayScore: 100 + (day % 5) }));
      box.set(`d-${day}`, { [A]: rotation("a"), [B]: rotation("b") });
    }
    return { games, box };
  }
  const target = game({ id: "target", tipUtc: "2026-11-13T00:30:00Z" });
  const report = point([
    [A, "a-0", "O"], [A, "a-1", "O"], [A, "a-2", "Q"], [A, "a-3", "D"], [A, "a-4", "P"],
    [B, "b-0", "Q"], [B, "b-1", "O"], [B, "b-2", "P"], [B, "b-3", "O"],
  ]);

  it("stores every player largest first, adds up to the side's points, and never feeds the number", () => {
    const { games, box } = deep();
    const source = { boxScores: (id: string) => box.get(id), availability: () => null };
    const sealWith = (nameOf: (id: string) => string) =>
      sealInjuryGames([{ game: target, inputsIncomplete: false, missingGameIds: [], kind: "final" }], {
        ...context(),
        seasonGames: [...games, target],
        source,
        nameOf,
        report: { point: report, stale: false, missing: false },
      })[0];
    const row = sealWith((id) => `Name ${id}`);
    expect(row.driversComplete).toBe(true);
    expect(row.drivers?.home).toHaveLength(5);
    expect(row.drivers?.away).toHaveLength(4);
    for (const side of ["home", "away"] as const) {
      const list = row.drivers?.[side] ?? [];
      const total = list.reduce((sum, driver) => sum + driver.points, 0);
      expect(Math.abs(total - (row.absencePoints?.[side] ?? 0))).toBeLessThan(0.01);
      for (let index = 1; index < list.length; index += 1) {
        expect(list[index].points).toBeLessThanOrEqual(list[index - 1].points);
      }
    }
    // The number is the engine's: ratings and the expected absences, nothing from the drivers.
    const frozen = replayFullStrength([...games, target], MODEL, source, { throughEtDate: target.etDate });
    const book = frozen.tracker.book;
    const home = expectedAbsence(report, A, book, INJURY_STATUS_TABLE, INJURY_PARAMS);
    const away = expectedAbsence(report, B, book, INJURY_STATUS_TABLE, INJURY_PARAMS);
    const expected = predictGame(
      frozen.state,
      { homeId: A, awayId: B, neutral: false, playoff: false, homeOnBackToBack: false, awayOnBackToBack: false },
      LIVE_PARAMS,
      -INJURY_PARAMS.beta * (home - away),
    );
    expect(row.homeWinProbability).toBe(Number(expected.homeWinProbability.toFixed(6)));
    expect(row.absence).toEqual({ home: Number(home.toFixed(4)), away: Number(away.toFixed(4)) });
    // Different names, same number.
    expect(sealWith((id) => id.toUpperCase()).homeWinProbability).toBe(row.homeWinProbability);
  });
});
