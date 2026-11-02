import { describe, expect, it } from "vitest";
import {
  absenceClass,
  normalizePersonName,
  reportNameKey,
  resolvePlayer,
  addToNameIndex,
  createNameIndex,
  isDevelopmentLeagueReason,
  teamIdFromReportName,
} from "@/lib/season/availability";
import { gameScore, type StoredLine } from "@/lib/season/box-scores";
import {
  buildSurvivalTable,
  expectedAbsence,
  expectedFurtherGames,
  lostValue,
  recordPlayerGame,
  replayInjuryModel,
  survivalBucket,
  type ForecastRow,
  type InjuryParams,
  type PlayerBook,
  type ReportPoint,
  type StatusTable,
} from "@/lib/season/injury-model";
import { LIVE_PARAMS } from "@/lib/season/params";
import { createFilterState } from "@/lib/season/ratings";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { SeasonGame } from "@/lib/season/types";

const PARAMS: InjuryParams = { beta: 0.4, gRep: 0.2, k: 1000, lG: 2000, lM: 10 };
const TABLE: StatusTable = { O: 0.99, D: 0.9, Q: 0.5, P: 0.1, A: 0.02 };
const [HOME, AWAY] = SEASON_TEAMS.map((team) => team.id);

function bookWith(lines: StoredLine[], teamId = HOME, games = 40): PlayerBook {
  const book: PlayerBook = new Map();
  for (let index = 0; index < games; index += 1) recordPlayerGame(book, teamId, lines, PARAMS);
  return book;
}

function point(rows: ReportPoint["rows"]): ReportPoint {
  return { at: "2026-01-15T18:00", notSubmitted: [], rows };
}

describe("game score", () => {
  it("matches Hollinger's formula", () => {
    const value = gameScore({
      points: 30,
      fieldGoalsMade: 11,
      fieldGoalsAttempted: 20,
      freeThrowsMade: 6,
      freeThrowsAttempted: 8,
      offensiveRebounds: 2,
      defensiveRebounds: 6,
      assists: 5,
      steals: 1,
      blocks: 1,
      turnovers: 3,
      fouls: 2,
    });
    expect(value).toBeCloseTo(30 + 4.4 - 14 - 0.8 + 1.4 + 1.8 + 1 + 3.5 + 0.7 - 0.8 - 3, 6);
  });
});

describe("player value", () => {
  it("is higher for a better player with the same minutes", () => {
    const book = bookWith([
      ["star", 35, 25],
      ["role", 35, 9],
    ]);
    expect(lostValue(book, "star", PARAMS)).toBeGreaterThan(lostValue(book, "role", PARAMS));
  });

  it("is higher for a player with more minutes at the same rate", () => {
    const book = bookWith([
      ["starter", 36, 18],
      ["bench", 12, 6],
    ]);
    expect(lostValue(book, "starter", PARAMS)).toBeGreaterThan(lostValue(book, "bench", PARAMS));
  });

  it("is zero for someone at or below replacement level, and for strangers", () => {
    const book = bookWith([["scrub", 20, 2]]);
    expect(lostValue(book, "scrub", PARAMS)).toBe(0);
    expect(lostValue(book, "nobody", PARAMS)).toBe(0);
  });

  it("shrinks a small sample toward replacement level", () => {
    const few = bookWith([["rookie", 30, 24]], HOME, 2);
    const many = bookWith([["rookie", 30, 24]], HOME, 60);
    expect(lostValue(few, "rookie", PARAMS)).toBeLessThan(lostValue(many, "rookie", PARAMS));
  });

  it("uses recent minutes more than old ones", () => {
    const book = bookWith([["player", 35, 20]], HOME, 30);
    const before = lostValue(book, "player", PARAMS);
    for (let index = 0; index < 20; index += 1) {
      recordPlayerGame(book, HOME, [["player", 10, 6]], PARAMS);
    }
    expect(lostValue(book, "player", PARAMS)).toBeLessThan(before);
  });
});

describe("expected absence", () => {
  const book = bookWith([["star", 35, 25]]);
  const row = (status: ReportPoint["rows"][number]["status"]) => ({
    teamId: HOME,
    athleteId: "star",
    status,
    reason: "Injury/Illness - Knee",
  });

  it("is never negative and rises as a status worsens", () => {
    const values = (["A", "P", "Q", "D", "O"] as const).map((status) =>
      expectedAbsence(point([row(status)]), HOME, book, TABLE, PARAMS),
    );
    expect(values[0]).toBeGreaterThanOrEqual(0);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThan(values[index - 1]);
    }
  });

  it("ignores other teams, unknown names and a missing report", () => {
    expect(expectedAbsence(point([row("O")]), AWAY, book, TABLE, PARAMS)).toBe(0);
    expect(
      expectedAbsence(point([{ ...row("O"), athleteId: null }]), HOME, book, TABLE, PARAMS),
    ).toBe(0);
    expect(expectedAbsence(null, HOME, book, TABLE, PARAMS)).toBe(0);
  });

  it("is zero for a replacement-level player", () => {
    const low = bookWith([["scrub", 20, 2]]);
    expect(
      expectedAbsence(
        point([{ teamId: HOME, athleteId: "scrub", status: "O", reason: "Rest" }]),
        HOME,
        low,
        TABLE,
        PARAMS,
      ),
    ).toBe(0);
  });
});

function makeGame(
  id: string,
  etDate: string,
  homeScore: number,
  awayScore: number,
  overrides: Partial<SeasonGame> = {},
): SeasonGame {
  return {
    id,
    season: 2026,
    kind: "regular",
    tipUtc: `${etDate}T23:00:00Z`,
    etDate,
    homeId: HOME,
    awayId: AWAY,
    neutral: false,
    status: "final",
    homeScore,
    awayScore,
    ...overrides,
  };
}

describe("replay", () => {
  const homeLines: StoredLine[] = [["star", 35, 25], ["role", 30, 9]];
  const awayLines: StoredLine[] = [["other", 35, 15], ["other2", 30, 9]];
  const rows = (
    games: SeasonGame[],
    listed: ReportPoint | null,
    box: (id: string) => Record<string, StoredLine[]> | undefined,
  ) => {
    const collected: ForecastRow[] = [];
    replayInjuryModel({
      games,
      state: createFilterState(LIVE_PARAMS),
      stateSeason: 2026,
      params: LIVE_PARAMS,
      injury: PARAMS,
      statusTable: TABLE,
      boxScores: box,
      availability: () => ({ morning: listed, final: listed }),
      onForecast: (row) => collected.push(row),
    });
    return collected;
  };
  const dates = Array.from({ length: 10 }, (_, index) => `2026-01-${String(index + 1).padStart(2, "0")}`);
  const fullBox = () => ({ [HOME]: homeLines, [AWAY]: awayLines });

  it("lowers the home team's chance when its star is listed out", () => {
    const games = dates.map((date, index) => makeGame(`g${index}`, date, 105, 100));
    const out = point([{ teamId: HOME, athleteId: "star", status: "O", reason: "Knee" }]);
    const last = rows(games, out, fullBox).at(-1) as ForecastRow;
    expect(last.final.homeWinProbability).toBeLessThan(last.plain.homeWinProbability);
    expect(last.finalAbsence.home).toBeGreaterThan(0);
  });

  it("keeps equal teams with equal absences at the same number as no absences", () => {
    const games = dates.map((date, index) => makeGame(`g${index}`, date, 100, 100, { neutral: true }));
    const shared: StoredLine[] = [["star", 35, 25]];
    const box = () => ({ [HOME]: shared, [AWAY]: [["star2", 35, 25]] as StoredLine[] });
    const both = point([
      { teamId: HOME, athleteId: "star", status: "O", reason: "Knee" },
      { teamId: AWAY, athleteId: "star2", status: "O", reason: "Knee" },
    ]);
    const last = rows(games, both, box).at(-1) as ForecastRow;
    expect(last.final.homeWinProbability).toBeCloseTo(last.plain.homeWinProbability, 10);
  });

  it("forecasts every game on a date from the same state", () => {
    const [third, fourth] = SEASON_TEAMS.slice(2, 4).map((team) => team.id);
    const scenario = (homeScore: number, awayScore: number) => {
      const games = [
        makeGame("early", "2026-01-02", homeScore, awayScore, { tipUtc: "2026-01-02T18:00:00Z" }),
        makeGame("late", "2026-01-02", 100, 90, {
          homeId: HOME,
          awayId: third,
          tipUtc: "2026-01-03T02:00:00Z",
        }),
        makeGame("next", "2026-01-03", 100, 90, { homeId: HOME, awayId: fourth }),
      ];
      const collected = rows(games, null, () => undefined);
      return {
        late: collected.find((row) => row.game.id === "late") as ForecastRow,
        next: collected.find((row) => row.game.id === "next") as ForecastRow,
      };
    };
    const won = scenario(130, 90);
    const lost = scenario(90, 130);
    // The early result cannot reach a game later on the same date...
    expect(won.late.plain.expectedMargin).toBeCloseTo(lost.late.plain.expectedMargin, 10);
    // ...but it does reach the next date.
    expect(won.next.plain.expectedMargin).toBeGreaterThan(lost.next.plain.expectedMargin);
  });

  it("has no absence term when no box score has ever been seen", () => {
    const games = dates.map((date, index) => makeGame(`g${index}`, date, 110, 100));
    const out = point([{ teamId: HOME, athleteId: "star", status: "O", reason: "Knee" }]);
    const noBox = rows(games, out, () => undefined).at(-1) as ForecastRow;
    expect(noBox.final.expectedMargin).toBeCloseTo(noBox.plain.expectedMargin, 10);
  });

  it("credits a team that won without its star by more than one that had him", () => {
    const warmup = dates.slice(0, 9).map((date, index) => makeGame(`g${index}`, date, 100, 100));
    const lastDay = makeGame("last", "2026-01-10", 110, 100);
    const after = makeGame("after", "2026-01-11", 100, 100);
    const games = [...warmup, lastDay, after];
    const withStar = rows(games, null, fullBox).at(-1) as ForecastRow;
    const without = rows(games, null, (id) =>
      id === "last" ? { [HOME]: [homeLines[1]], [AWAY]: awayLines } : fullBox(),
    ).at(-1) as ForecastRow;
    expect(without.plain.expectedMargin).toBeGreaterThan(withStar.plain.expectedMargin);
  });
});

describe("survival table", () => {
  it("buckets games missed so far", () => {
    expect([0, 1, 2, 3, 4, 7, 8, 15, 16, 30, 31, 200].map(survivalBucket)).toEqual([
      0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
    ]);
  });

  const rows = (count: number, missedBefore: number, further: number, kind: "long" | "short") =>
    Array.from({ length: count }, () => ({ missedBefore, further, class: kind }));

  it("gives a long absence more games at bucket zero", () => {
    const table = buildSurvivalTable([...rows(40, 0, 30, "long"), ...rows(40, 0, 2, "short")]);
    expect(table.classUsed).toBe(true);
    expect(expectedFurtherGames(table, 0, "long")).toBeGreaterThanOrEqual(
      expectedFurtherGames(table, 0, "short"),
    );
    expect(expectedFurtherGames(table, 0, "long")).toBe(30);
  });

  it("drops the class when the data does not support it", () => {
    const table = buildSurvivalTable([...rows(40, 0, 2, "long"), ...rows(40, 0, 5, "short")]);
    expect(table.classUsed).toBe(false);
    expect(expectedFurtherGames(table, 0, "long")).toBe(5);
  });

  it("pools a small cell with its neighbor in the same class", () => {
    const table = buildSurvivalTable([...rows(40, 2, 6, "short"), ...rows(5, 5, 20, "short")]);
    const pooled = (40 * 6 + 5 * 20) / 45;
    expect(expectedFurtherGames(table, 2, "short")).toBeCloseTo(pooled, 8);
    expect(expectedFurtherGames(table, 5, "short")).toBeCloseTo(pooled, 8);
  });
});

describe("names", () => {
  it("normalizes accents, punctuation and suffixes", () => {
    expect(normalizePersonName("Nikola Jokić")).toBe("nikola jokic");
    expect(normalizePersonName("T.J. McConnell")).toBe("tj mcconnell");
    expect(normalizePersonName("Gary Trent Jr.")).toBe("gary trent");
    expect(normalizePersonName("Kentavious Caldwell-Pope")).toBe("kentavious caldwellpope");
  });

  it("reads the report's Last, First form", () => {
    expect(reportNameKey("Trent Jr., Gary")).toBe("gary trent");
    expect(reportNameKey("McConnell, T.J.")).toBe("tj mcconnell");
  });

  it("prefers the team's roster, then a unique name, then gives up", () => {
    const index = createNameIndex();
    addToNameIndex(index, 2026, HOME, "1", "Same Name");
    addToNameIndex(index, 2026, AWAY, "2", "Same Name");
    addToNameIndex(index, 2025, AWAY, "3", "Only Once");
    expect(resolvePlayer(index, 2026, HOME, "Name, Same")).toBe("1");
    expect(resolvePlayer(index, 2026, AWAY, "Name, Same")).toBe("2");
    expect(resolvePlayer(index, 2026, SEASON_TEAMS[2].id, "Name, Same")).toBeNull();
    expect(resolvePlayer(index, 2026, HOME, "Once, Only")).toBe("3");
    expect(resolvePlayer(index, 2026, HOME, "Nobody, Noah")).toBeNull();
  });
});

describe("reasons and teams", () => {
  it("classes long-term wording as long, anything else as short", () => {
    expect(absenceClass("Injury/Illness - Right ACL Repair / Surgery")).toBe("long");
    expect(absenceClass("Injury/Illness - Right Partially Torn Hamstring")).toBe("long");
    expect(absenceClass("Injury/Illness - Left Achilles; Rupture")).toBe("long");
    expect(absenceClass("Injury/Illness - Left Ankle; Soreness")).toBe("short");
    expect(absenceClass("Rest")).toBe("short");
    expect(absenceClass(null)).toBe("short");
  });

  it("spots development league rows", () => {
    expect(isDevelopmentLeagueReason("G League - On Assignment")).toBe(true);
    expect(isDevelopmentLeagueReason("G League - Two-Way")).toBe(true);
    expect(isDevelopmentLeagueReason("Injury/Illness - Illness")).toBe(false);
  });

  it("fails closed on an unknown team name", () => {
    expect(teamIdFromReportName("Orlando Magic")).toBe("19");
    expect(() => teamIdFromReportName("Seattle SuperSonics")).toThrow(/unknown team/);
  });
});
