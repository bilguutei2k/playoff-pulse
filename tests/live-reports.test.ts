import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parseInjuries } from "@/lib/live-data/espn-season";
import { quarterReportNames, reportForSlate, type ParsedReport } from "@/lib/live-data/nba-reports";
import {
  chooseReport,
  emptyReportDay,
  gameAvailabilityFromDay,
  latestReport,
  toReportPoint,
  wallClockHours,
  type LiveReportDay,
} from "@/lib/season/live-reports";
import { formatReportTime } from "@/lib/utils/dates";
import {
  INJURY_PARAMS,
  INJURY_STATUS_TABLE,
  INJURY_SURVIVAL,
} from "@/lib/season/params";

const ORL = "19";
const BOS = "2";
const IND = "11";
const BKN = "17";

function day(reports: Record<string, LiveReportDay["reports"][string]>): LiveReportDay {
  return {
    ...emptyReportDay("2026-11-01"),
    reports,
    files: Object.fromEntries(
      Object.entries(reports).map(([at, report]) => [report.file, { at, usable: true }]),
    ),
  };
}

const MORNING = {
  file: "2026-11-01_06_45AM",
  notSubmitted: [],
  rows: [[ORL, "Banchero, Paolo", "O", "Injury/Illness - Ankle"]] as LiveReportDay["reports"][string]["rows"],
};
const AFTERNOON = {
  file: "2026-11-01_01_15PM",
  notSubmitted: [BKN],
  rows: [
    [ORL, "Banchero, Paolo", "O", "Injury/Illness - Ankle"],
    [BOS, "Robinson, Mitchell", "O", "Rest"],
  ] as LiveReportDay["reports"][string]["rows"],
};
const STORED = day({ "2026-11-01T06:45": MORNING, "2026-11-01T13:15": AFTERNOON });

describe("frozen injury inputs", () => {
  it("match docs/live/injury-fit.json exactly", () => {
    const fit = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "docs/live/injury-fit.json"), "utf-8"),
    );
    expect(INJURY_PARAMS).toEqual(fit.fitted);
    expect(INJURY_STATUS_TABLE).toEqual(
      Object.fromEntries(
        Object.entries(fit.statusTable as Record<string, { absent: number }>).map(([code, row]) => [code, row.absent]),
      ),
    );
    expect(INJURY_SURVIVAL).toEqual({
      long: fit.survival.long,
      short: fit.survival.short,
      classUsed: fit.survival.classUsed,
    });
  });
});

describe("report candidates", () => {
  it("steps back through quarter-hour names from now, newest first", () => {
    expect(quarterReportNames("2026-11-01T13:07", 3)).toEqual([
      "2026-11-01_01_00PM",
      "2026-11-01_12_45PM",
      "2026-11-01_12_30PM",
    ]);
  });

  it("crosses midnight and noon correctly", () => {
    expect(quarterReportNames("2026-11-02T00:10", 2)).toEqual([
      "2026-11-02_12_00AM",
      "2026-11-01_11_45PM",
    ]);
    expect(quarterReportNames("2026-11-01T12:00", 1)).toEqual(["2026-11-01_12_00PM"]);
  });
});

describe("validating a report against the slate", () => {
  const parsed: ParsedReport = {
    issuedEt: "2026-11-01T13:15",
    rows: [
      { gameDate: "2026-11-01", matchup: "BOS@ORL", team: "Boston Celtics", player: "Robinson, Mitchell", status: "Questionable", reason: "Rest" },
      { gameDate: "2026-11-01", matchup: "BOS@ORL", team: "Orlando Magic", player: "Banchero, Paolo", status: "Out", reason: "Injury/Illness - Ankle" },
      { gameDate: "2026-11-01", matchup: "BKN@IND", team: "Brooklyn Nets", player: null, status: null, reason: "NOT YET SUBMITTED" },
      { gameDate: "2026-11-01", matchup: "BKN@IND", team: "Indiana Pacers", player: "Haliburton, Tyrese", status: "Out", reason: "Injury/Illness - Achilles; Surgery" },
      { gameDate: "2026-11-02", matchup: "OKC@CLE", team: "Oklahoma City Thunder", player: null, status: null, reason: "NOT YET SUBMITTED" },
    ],
  };
  const slate = [
    { homeId: ORL, awayId: BOS },
    { homeId: IND, awayId: BKN },
  ];

  it("keeps the slate's rows as team, name, status code and reason", () => {
    const result = reportForSlate(parsed, "2026-11-01_01_15PM", "2026-11-01", slate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.notSubmitted).toEqual([BKN]);
    expect(result.report.rows).toEqual([
      [BOS, "Robinson, Mitchell", "Q", "Rest"],
      [ORL, "Banchero, Paolo", "O", "Injury/Illness - Ankle"],
      [IND, "Haliburton, Tyrese", "O", "Injury/Illness - Achilles; Surgery"],
    ]);
  });

  it("keeps the report when one team has nobody listed, as the Bucks did on 2026-11-02", () => {
    const withoutBrooklyn = { ...parsed, rows: parsed.rows.filter((row) => row.team !== "Brooklyn Nets") };
    const result = reportForSlate(withoutBrooklyn, "f", "2026-11-01", slate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unlisted).toEqual([BKN]);
    expect(result.report.rows.map((row) => row[0])).toEqual([BOS, ORL, IND]);
  });

  it("treats a game with neither team on the report as nobody listed", () => {
    const result = reportForSlate(parsed, "f", "2026-11-01", [...slate, { homeId: "13", awayId: "28" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unlisted).toEqual(["13", "28"]);
  });

  it("is unusable when under half of the slate's games appear", () => {
    const result = reportForSlate(parsed, "f", "2026-11-01", [
      ...slate,
      { homeId: "13", awayId: "28" },
      { homeId: "5", awayId: "6" },
      { homeId: "7", awayId: "9" },
    ]);
    expect(result).toEqual({ ok: false, problem: "only 2 of 5 slate games appear on 2026-11-01" });
  });

  it("fails closed on a team name it cannot place", () => {
    const odd = { ...parsed, rows: [{ ...parsed.rows[0], team: "Seattle Supersonics" }] };
    const result = reportForSlate(odd, "f", "2026-11-01", slate);
    expect(result.ok).toBe(false);
  });
});

describe("choosing the report a run uses", () => {
  it("takes the latest stored report at or before now", () => {
    expect(latestReport(STORED, "2026-11-01T13:00")?.at).toBe("2026-11-01T06:45");
    expect(latestReport(STORED, "2026-11-01T13:15")?.at).toBe("2026-11-01T13:15");
    expect(latestReport(STORED, "2026-11-01T06:00")).toBeNull();
    expect(latestReport(null, "2026-11-01T13:00")).toBeNull();
  });

  it("is current when the fetch confirmed it", () => {
    // 13:40 ET is 18:40 UTC on Nov 1, 2026.
    const chosen = chooseReport(STORED, true, "2026-11-01T18:40:00Z");
    expect(chosen).toMatchObject({ at: "2026-11-01T13:15", stale: false, missing: false });
  });

  it("falls back to the last good report, flagged, when the fetch failed", () => {
    const chosen = chooseReport(STORED, false, "2026-11-01T18:40:00Z");
    expect(chosen).toMatchObject({ at: "2026-11-01T13:15", stale: true, missing: false });
  });

  it("says availability is missing past 24 hours, or with nothing stored", () => {
    expect(chooseReport(STORED, false, "2026-11-02T18:20:00Z")).toMatchObject({ at: null, missing: true, report: null });
    expect(chooseReport(null, true, "2026-11-01T18:40:00Z").missing).toBe(true);
    expect(wallClockHours("2026-11-01T13:15", "2026-11-02T13:14")).toBeLessThan(24);
  });

  it("resolves printed names into the engine's rows", () => {
    const point = toReportPoint(AFTERNOON, "2026-11-01T13:15", (teamId, printed) =>
      printed.startsWith("Banchero") && teamId === ORL ? "4432166" : null,
    );
    expect(point.rows).toEqual([
      { teamId: ORL, athleteId: "4432166", status: "O", reason: "Injury/Illness - Ankle" },
      { teamId: BOS, athleteId: null, status: "O", reason: "Rest" },
    ]);
    expect(point.notSubmitted).toEqual([BKN]);
    expect(point.printed).toEqual(["Banchero, Paolo", "Robinson, Mitchell"]);
  });

  it("gives a finished game its morning and pre-tip reports, cut to its teams", () => {
    const availability = gameAvailabilityFromDay(
      STORED,
      { etDate: "2026-11-01", tipUtc: "2026-11-01T20:30Z", homeId: ORL, awayId: BOS },
      () => "x",
    );
    expect(availability?.morning).toBeNull();
    expect(availability?.final?.at).toBe("2026-11-01T13:15");
    expect(availability?.final?.rows.map((row) => row.teamId)).toEqual([ORL, BOS]);
    expect(availability?.final?.notSubmitted).toEqual([]);
    const early = gameAvailabilityFromDay(
      STORED,
      { etDate: "2026-11-01", tipUtc: "2026-11-01T17:00Z", homeId: ORL, awayId: BOS },
      () => "x",
    );
    expect(early?.final?.at).toBe("2026-11-01T06:45");
    expect(gameAvailabilityFromDay(null, { etDate: "2026-11-01", tipUtc: "2026-11-01T17:00Z", homeId: ORL, awayId: BOS }, () => null)).toBeNull();
  });

  it("prints a report time in Eastern time", () => {
    expect(formatReportTime("2026-11-01T13:15")).toBe("1:15 PM ET");
    expect(formatReportTime("2026-11-01T00:05")).toBe("12:05 AM ET");
  });
});

describe("ESPN injury capture", () => {
  it("stores ESPN's return date and fantasy status, never needing them", () => {
    const rows = parseInjuries({
      injuries: [
        {
          id: "1",
          injuries: [
            {
              id: "77",
              status: "Out",
              date: "2026-11-02T02:02Z",
              athlete: { displayName: "Trae Young" },
              details: { returnDate: "2026-11-20", fantasyStatus: { abbreviation: "OUT" } },
            },
            { id: "78", status: "Day-To-Day", date: "x", athlete: { displayName: "Jalen Johnson" } },
          ],
        },
      ],
    });
    expect(rows[0]).toMatchObject({ name: "Trae Young", returnDate: "2026-11-20", fantasyStatus: "OUT" });
    expect(rows[1]).toMatchObject({ returnDate: null, fantasyStatus: null });
  });
});
