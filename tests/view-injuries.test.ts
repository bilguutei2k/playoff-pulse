import { describe, expect, it } from "vitest";
import type { LiveReport } from "@/lib/season/live-reports";
import { providerName } from "@/lib/season/market";
import type { AbsenceDriver } from "@/lib/season/types";
import { displayName, nameKey } from "@/lib/utils/injuries";
import { absenceSides, cardInjuryLine, cardInjuryLines, filingNote, othersNote } from "@/lib/view/injuries";

const IND = "11";
const ATL = "1";

const driver = (name: string, status: AbsenceDriver["status"], points: number): AbsenceDriver => ({
  athleteId: name,
  name,
  status,
  points,
});

// The stored 18:30 report for ATL at IND on 2026-11-02, and that game's final seal, which
// kept three drivers a side.
const report: LiveReport = {
  file: "2026-11-02_06_30PM",
  notSubmitted: [],
  rows: [
    [IND, "Furphy, Johnny", "O", "Injury/Illness - Right ACL Repair / Surgery"],
    [IND, "Haliburton, Tyrese", "O", "Injury/Illness - Left Hamstring Strain"],
    [IND, "McConnell, T.J.", "O", "Injury/Illness - Right Hamstring Strain"],
    [IND, "Nance Jr., Larry", "O", "Injury/Illness - Illness"],
    [IND, "Nembhard, Andrew", "O", "Injury/Illness - Cervical Injury Management"],
    [IND, "Nesmith, Aaron", "O", "Injury/Illness - Left Hamstring Injury Management"],
    [IND, "Sheppard, Ben", "O", "Injury/Illness - Left Meniscus Surgery"],
    [IND, "Siakam, Pascal", "O", "Rest"],
    [IND, "Toppin, Obi", "O", "Injury/Illness - Lumbar Sprain"],
    [IND, "Zubac, Ivica", "O", "Injury/Illness - Left Ankle Sprain"],
    [ATL, "Flemings, Kingston", "O", "League Suspension"],
    [ATL, "Gilbert, Keshon", "O", "G League - Two-Way"],
    [ATL, "Gueye, Mouhamed", "O", "Injury/Illness - Left Foot Fracture"],
    [ATL, "Johnson, Jalen", "O", "Injury/Illness - Left Ankle Sprain"],
    [ATL, "Landale, Jock", "O", "Injury/Illness - Left Hip Strain"],
    [ATL, "Veesaar, Henri", "O", "Injury/Illness - Right ACL Tear"],
    [ATL, "Wilson, Jalen", "O", "G League - Two-Way"],
  ],
};
const oldFinal = {
  absencePoints: { home: 12.225, away: 3.753 },
  drivers: {
    home: [driver("Tyrese Haliburton", "O", 2.653), driver("Pascal Siakam", "O", 2.359), driver("Andrew Nembhard", "O", 1.643)],
    away: [driver("Jalen Johnson", "O", 2.376), driver("Jock Landale", "O", 0.693), driver("Jalen Wilson", "O", 0.335)],
  },
  driversComplete: false,
  unfiled: null,
};

describe("display names", () => {
  it("reads the report's Last, First as First Last", () => {
    expect(displayName("Haliburton, Tyrese")).toBe("Tyrese Haliburton");
    expect(displayName("Nance Jr., Larry")).toBe("Larry Nance Jr.");
    expect(displayName("Udeh, Jr., Ernest")).toBe("Ernest Udeh Jr.");
    expect(displayName("McConnell, T.J.")).toBe("T.J. McConnell");
    expect(displayName("Tyrese Haliburton")).toBe("Tyrese Haliburton");
  });

  it("matches the report's names to box-score names", () => {
    expect(nameKey("Udeh, Jr., Ernest")).toBe(nameKey("Ernest Udeh Jr."));
    expect(nameKey("McConnell, T.J.")).toBe(nameKey("T.J. McConnell"));
    expect(nameKey("Dončić, Luka")).toBe(nameKey("Luka Doncic"));
  });

  it("gives each sportsbook one name", () => {
    expect(providerName("Draft Kings")).toBe("DraftKings");
    expect(providerName("DraftKings")).toBe("DraftKings");
    expect(providerName("Some Book")).toBe("Some Book");
  });
});

describe("lists for a seal that kept three drivers", () => {
  it("rebuild the rest from the report used, with only their combined points", () => {
    const sides = absenceSides({ forecast: oldFinal, homeId: IND, awayId: ATL, report });
    const home = sides!.home;
    expect(home.players).toHaveLength(10);
    expect(home.players.slice(0, 3)).toEqual([
      { athleteId: "Tyrese Haliburton", name: "Tyrese Haliburton", status: "O", points: 2.653 },
      { athleteId: "Pascal Siakam", name: "Pascal Siakam", status: "O", points: 2.359 },
      { athleteId: "Andrew Nembhard", name: "Andrew Nembhard", status: "O", points: 1.643 },
    ]);
    // Nobody else gets a per-player number, or a link: a name rebuilt from the report has no athlete ID.
    expect(home.players.slice(3).every((player) => player.points === null && player.athleteId === null)).toBe(true);
    expect(home.players.map((player) => player.name)).toContain("Larry Nance Jr.");
    expect(home.others?.count).toBe(7);
    expect(home.others?.points).toBeCloseTo(12.225 - 2.653 - 2.359 - 1.643, 9);
    expect(home.groups.map((group) => group.key)).toEqual(["out"]);
    expect(othersNote(home)).toBe(
      "This seal stored points for its three largest absences only. The other 7 listed players add −5.6 pts together.",
    );
    // Wilson, matched by name, is not listed twice.
    expect(sides!.away.players.map((player) => player.name)).toEqual([
      "Jalen Johnson", "Jock Landale", "Jalen Wilson", "Kingston Flemings", "Keshon Gilbert", "Mouhamed Gueye", "Henri Veesaar",
    ]);
    expect(sides!.away.others).toEqual({ count: 4, points: expect.closeTo(0.349, 9) });
  });

  it("say so when the report is not available, without naming anyone extra", () => {
    const home = absenceSides({ forecast: oldFinal, homeId: IND, awayId: ATL, report: null })!.home;
    expect(home.players).toHaveLength(3);
    expect(home.others).toEqual({ count: null, points: expect.closeTo(5.57, 9) });
  });

  it("say that a team that had not filed counted nobody", () => {
    const reissued = {
      ...oldFinal,
      absencePoints: { home: 0, away: 2.519 },
      drivers: { home: [], away: oldFinal.drivers.away },
    };
    const early: LiveReport = { ...report, notSubmitted: [IND], rows: report.rows.filter((row) => row[0] !== IND) };
    const home = absenceSides({ forecast: reissued, homeId: IND, awayId: ATL, report: early })!.home;
    expect(home.filing).toBe("unfiled-nobody");
    expect(home.players).toEqual([]);
    expect(cardInjuryLine(home)).toBe("IND: report not filed, nobody counted");
    expect(filingNote(home, false)).toBe(
      "IND had not filed that day's report when this was sealed. Seals written before the rule changed in November 2026 counted nobody for a team that had not filed.",
    );
  });

  it("are null for a number without the injury term", () => {
    expect(absenceSides({ forecast: { ...oldFinal, absencePoints: null }, homeId: IND, awayId: ATL, report })).toBeNull();
    expect(cardInjuryLines(null)).toBeNull();
  });
});

describe("lists for a complete seal", () => {
  const complete = {
    absencePoints: { home: 6.1, away: 1.0 },
    drivers: {
      home: [
        driver("Tyrese Haliburton", null, 2.65),
        driver("Pascal Siakam", null, 2.36),
        driver("Andrew Nembhard", null, 1.09),
      ],
      away: [
        driver("Jalen Johnson", "Q", 0.5),
        driver("Jock Landale", "P", 0.3),
        driver("Jalen Wilson", "O", 0.15),
        driver("Kobe Bufkin", "D", 0.05),
      ],
    },
    driversComplete: true,
    unfiled: { home: true, away: false },
  };

  it("group by status: out, missed the last game, doubtful, questionable, then probable or available", () => {
    const sides = absenceSides({ forecast: complete, homeId: IND, awayId: ATL, report: null })!;
    expect(sides.away.groups.map((group) => [group.key, group.players.map((player) => player.name)])).toEqual([
      ["out", ["Jalen Wilson"]],
      ["doubtful", ["Kobe Bufkin"]],
      ["questionable", ["Jalen Johnson"]],
      ["probable", ["Jock Landale"]],
    ]);
    expect(sides.home.filing).toBe("unfiled-counted");
    expect(sides.home.groups.map((group) => group.key)).toEqual(["missed"]);
    expect(filingNote(sides.home, true)).toBe(
      "IND had not filed today's report when this was sealed, so this counts players who missed its last game.",
    );
    expect(sides.away.others).toBeNull();
  });
});

describe("card injury line", () => {
  it("names the top three by points, then how many more", () => {
    const home = absenceSides({ forecast: oldFinal, homeId: IND, awayId: ATL, report })!.home;
    expect(cardInjuryLine(home)).toBe("IND −12.2: Haliburton, Siakam, Nembhard out +7 more");
  });

  it("names only out, doubtful and questionable players, each with its word when they differ", () => {
    const forecast = {
      absencePoints: { home: 4.2, away: 0.4 },
      drivers: {
        home: [
          driver("Tyrese Haliburton", "Q", 1.4),
          driver("Ben Smith", "A", 1.2),
          driver("Pascal Siakam", "O", 1.1),
          driver("Obi Toppin", "P", 0.3),
          driver("Ivica Zubac", "D", 0.2),
          driver("Aaron Nesmith", "O", 0.1),
        ],
        away: [driver("Jalen Johnson", "O", 0.4)],
      },
      driversComplete: true,
      unfiled: { home: false, away: false },
    };
    const lines = cardInjuryLines(absenceSides({ forecast, homeId: IND, awayId: ATL, report: null }));
    // ATL's 0.4 points stay off the card; the game page lists them.
    expect(lines).toEqual(["IND −4.2: Haliburton questionable, Siakam out, Zubac doubtful +1 more"]);
    expect(lines!.join(" ")).not.toMatch(/Smith|Toppin|available|probable/);
  });

  it("says when a side's report was not filed", () => {
    const forecast = {
      absencePoints: { home: 5.0, away: 0 },
      drivers: { home: [driver("Tyrese Haliburton", null, 2.7), driver("Pascal Siakam", null, 2.3)], away: [] },
      driversComplete: true,
      unfiled: { home: true, away: false },
    };
    expect(cardInjuryLines(absenceSides({ forecast, homeId: IND, awayId: ATL, report: null }))).toEqual([
      "IND −5.0 (report not filed): Haliburton, Siakam missed last game",
    ]);
  });
});
