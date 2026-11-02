import { describe, expect, it } from "vitest";
import {
  parseReportPages,
  reportFileName,
  type PdfTextItem,
} from "@/lib/live-data/nba-reports";
import { parseBoxScore } from "@/lib/live-data/espn-season";

const COLUMNS = { date: 24, time: 120, matchup: 200, team: 264, player: 425, status: 586, reason: 666 };

/** Word-level layout: y falls down the page, and each word is its own item. */
function words(text: string, x: number, y: number): PdfTextItem[] {
  let cursor = x;
  return text.split(" ").map((word) => {
    const item = { text: word, x: cursor, y };
    cursor += word.length * 6 + 3;
    return item;
  });
}

const HEADER = [
  ...words("Game Date", COLUMNS.date, 480),
  ...words("Game Time", COLUMNS.time, 480),
  ...words("Matchup", COLUMNS.matchup, 480),
  ...words("Team", COLUMNS.team, 480),
  ...words("Player Name", COLUMNS.player, 480),
  ...words("Current Status", COLUMNS.status, 480),
  ...words("Reason", COLUMNS.reason, 480),
];

const TITLE = words("Injury Report: 11/01/26 01:15 PM", 289, 533);

function row(y: number, cells: Partial<Record<keyof typeof COLUMNS, string>>): PdfTextItem[] {
  return Object.entries(cells).flatMap(([column, text]) =>
    words(text as string, COLUMNS[column as keyof typeof COLUMNS], y),
  );
}

describe("injury report parser, word-level layout", () => {
  const page: PdfTextItem[] = [
    ...TITLE,
    ...HEADER,
    ...row(459, {
      date: "11/01/2026",
      time: "03:30 (ET)",
      matchup: "BOS@ORL",
      team: "Boston Celtics",
      player: "Carter, Devin",
      status: "Out",
      reason: "Injury/Illness - Illness",
    }),
    ...row(437, { player: "Robinson, Mitchell", status: "Out", reason: "Rest" }),
    ...row(407, { team: "Orlando Magic", player: "Banchero, Paolo", status: "Questionable" }),
    // A wrapped reason is centered on its row.
    ...row(414, { reason: "Injury/Illness - Right Low Grade" }),
    ...row(400, { reason: "High Ankle Sprain" }),
    ...row(380, {
      time: "05:00 (ET)",
      matchup: "BKN@IND",
      team: "Brooklyn Nets",
      player: "Bilodeau, Tyler",
      status: "Out",
      reason: "G League - Two-",
    }),
    ...row(366, { reason: "Way" }),
    ...row(340, { team: "Indiana Pacers", reason: "NOT YET SUBMITTED" }),
    ...words("Page 1 of 2", 399, 50),
  ];

  const report = parseReportPages([page]);

  it("reads the report's own timestamp", () => {
    expect(report.issuedEt).toBe("2026-11-01T13:15");
  });

  it("carries the date, matchup and team down the rows", () => {
    expect(report.rows.map((entry) => [entry.matchup, entry.team, entry.player])).toEqual([
      ["BOS@ORL", "Boston Celtics", "Carter, Devin"],
      ["BOS@ORL", "Boston Celtics", "Robinson, Mitchell"],
      ["BOS@ORL", "Orlando Magic", "Banchero, Paolo"],
      ["BKN@IND", "Brooklyn Nets", "Bilodeau, Tyler"],
      ["BKN@IND", "Indiana Pacers", null],
    ]);
    expect(new Set(report.rows.map((entry) => entry.gameDate))).toEqual(new Set(["2026-11-01"]));
  });

  it("joins wrapped reasons to the nearest player", () => {
    expect(report.rows[2].reason).toBe("Injury/Illness - Right Low Grade High Ankle Sprain");
    expect(report.rows[1].reason).toBe("Rest");
  });

  it("re-joins a word wrapped at its hyphen", () => {
    expect(report.rows[3].reason).toBe("G League - Two-Way");
  });

  it("marks a team that has not filed", () => {
    expect(report.rows[4].status).toBeNull();
    expect(report.rows[4].reason).toBe("NOT YET SUBMITTED");
  });

  it("handles a later page that repeats the title, without its own header", () => {
    const second: PdfTextItem[] = [
      ...TITLE,
      ...row(459, { player: "Isaac, Jonathan", status: "Doubtful", reason: "Left Knee" }),
      ...words("Page 2 of 2", 399, 50),
    ];
    const both = parseReportPages([page, second]);
    const last = both.rows.at(-1);
    expect(last?.player).toBe("Isaac, Jonathan");
    expect(last?.team).toBe("Indiana Pacers");
    expect(last?.status).toBe("Doubtful");
  });
});

describe("injury report parser, rotated layout", () => {
  // Older reports are rotated: x runs down the page, and y runs across it.
  const cell = (text: string, column: keyof typeof COLUMNS, down: number): PdfTextItem => ({
    text,
    x: down,
    y: COLUMNS[column],
  });
  const page: PdfTextItem[] = [
    { text: "Injury Report: 01/15/22 05:30 PM", x: 24, y: 314 },
    cell("Game Date", "date", 64),
    cell("Game Time", "time", 64),
    cell("Matchup", "matchup", 64),
    cell("Team", "team", 64),
    cell("Player Name", "player", 64),
    cell("Current Status", "status", 64),
    cell("Reason", "reason", 64),
    cell("01/15/2022", "date", 83),
    cell("06:30 (ET)", "time", 83),
    cell("TOR@MIL", "matchup", 83),
    cell("Milwaukee Bucks", "team", 83),
    cell("Holiday, Jrue", "player", 83),
    cell("Out", "status", 83),
    cell("Injury/Illness - Left Ankle; Soreness", "reason", 83),
    cell("Toronto Raptors", "team", 101),
    cell("Trent Jr., Gary", "player", 101),
    cell("Doubtful", "status", 101),
    cell("Injury/Illness - Left Ankle; Swelling", "reason", 101),
  ];

  it("detects the layout and reads the same fields", () => {
    const report = parseReportPages([page]);
    expect(report.issuedEt).toBe("2022-01-15T17:30");
    expect(report.rows).toEqual([
      {
        gameDate: "2022-01-15",
        matchup: "TOR@MIL",
        team: "Milwaukee Bucks",
        player: "Holiday, Jrue",
        status: "Out",
        reason: "Injury/Illness - Left Ankle; Soreness",
      },
      {
        gameDate: "2022-01-15",
        matchup: "TOR@MIL",
        team: "Toronto Raptors",
        player: "Trent Jr., Gary",
        status: "Doubtful",
        reason: "Injury/Illness - Left Ankle; Swelling",
      },
    ]);
  });
});

describe("injury report parser fails closed", () => {
  const base = [...TITLE, ...HEADER];
  const good = {
    date: "11/01/2026",
    time: "03:30 (ET)",
    matchup: "BOS@ORL",
    team: "Boston Celtics",
    player: "Carter, Devin",
    status: "Out",
    reason: "Rest",
  };

  it("rejects a missing title", () => {
    expect(() => parseReportPages([[...HEADER, ...row(459, good)]])).toThrow(/no timestamp/);
  });

  it("rejects a missing header on the first page", () => {
    expect(() => parseReportPages([[...TITLE, ...row(459, good)]])).toThrow(/no header/);
  });

  it("rejects an unknown status", () => {
    expect(() => parseReportPages([[...base, ...row(459, { ...good, status: "Maybe" })]])).toThrow(
      /no valid status/,
    );
  });

  it("rejects a player not in Last, First form", () => {
    expect(() =>
      parseReportPages([[...base, ...row(459, { ...good, player: "Devin Carter" })]]),
    ).toThrow(/Last, First/);
  });

  it("rejects a bad matchup", () => {
    expect(() =>
      parseReportPages([[...base, ...row(459, { ...good, matchup: "BOS-ORL" })]]),
    ).toThrow(/bad matchup/);
  });
});

describe("report file names", () => {
  it("uses both naming styles", () => {
    expect(reportFileName("2022-01-15", 17, 0, "hourly")).toBe("2022-01-15_05PM");
    expect(reportFileName("2026-11-01", 13, 15, "quarter")).toBe("2026-11-01_01_15PM");
    expect(reportFileName("2026-11-01", 0, 0, "quarter")).toBe("2026-11-01_12_00AM");
    expect(reportFileName("2022-01-15", 12, 0, "hourly")).toBe("2022-01-15_12PM");
  });
});

describe("box score parser", () => {
  const labels = ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"];
  const athlete = (id: string, name: string, stats: string[]) => ({
    athlete: { id, displayName: name },
    stats,
  });
  const line = (minutes: string, points: string) => [
    minutes, points, "5-10", "1-3", "4-5", "6", "3", "2", "1", "0", "1", "5", "2", "+4",
  ];
  const payload = (first: unknown[], second: unknown[] = [athlete("9", "B", line("30", "10"))]) => ({
    boxscore: {
      players: [
        { team: { id: "2" }, statistics: [{ labels, athletes: first }] },
        { team: { id: "19" }, statistics: [{ labels, athletes: second }] },
      ],
    },
  });

  it("reads stats by column name and skips players without minutes", () => {
    const box = parseBoxScore(
      payload([
        athlete("1", "Star", line("35", "28")),
        athlete("2", "Sat Out", []),
        athlete("3", "Zero", line("0", "0")),
      ]),
      "g",
    );
    expect(box["2"].map((row) => row.athleteId)).toEqual(["1"]);
    expect(box["2"][0]).toMatchObject({
      name: "Star",
      minutes: 35,
      points: 28,
      fieldGoalsMade: 5,
      fieldGoalsAttempted: 10,
      freeThrowsAttempted: 5,
      offensiveRebounds: 1,
      defensiveRebounds: 5,
    });
  });

  it("fails closed on a changed layout", () => {
    expect(() => parseBoxScore({ boxscore: { players: [] } }, "g")).toThrow(/expected 2 teams/);
    expect(() =>
      parseBoxScore(
        {
          boxscore: {
            players: [
              { team: { id: "2" }, statistics: [{ labels: ["MIN"], athletes: [] }] },
              { team: { id: "19" }, statistics: [{ labels, athletes: [] }] },
            ],
          },
        },
        "g",
      ),
    ).toThrow(/no PTS column/);
    expect(() => parseBoxScore(payload([athlete("1", "A", ["35", "x", ...line("1", "1").slice(2)])]), "g")).toThrow(
      /PTS is not a number/,
    );
  });
});
