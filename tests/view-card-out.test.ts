import { describe, expect, it } from "vitest";
import type { LiveReport } from "@/lib/season/live-reports";
import type { AbsenceDriver } from "@/lib/season/types";
import { CARD_OUT_CHARS, cardOutKey, cardOutNames, cardOutSide } from "@/lib/view/card-out";
import { absenceSides, type AbsenceSide } from "@/lib/view/injuries";

const IND = "11";
const ATL = "1";

const driver = (name: string, status: AbsenceDriver["status"], points: number): AbsenceDriver => ({
  athleteId: `id-${name}`,
  name,
  status,
  points,
});

function sides(home: AbsenceDriver[], away: AbsenceDriver[], complete = true, report: LiveReport | null = null) {
  const sum = (list: AbsenceDriver[]) => list.reduce((total, item) => total + item.points, 0);
  return absenceSides({
    forecast: {
      absencePoints: { home: sum(home), away: sum(away) },
      drivers: { home, away },
      driversComplete: complete,
      unfiled: null,
    },
    homeId: IND,
    awayId: ATL,
    report,
  })!;
}

describe("card out names", () => {
  it("names the two largest, largest first, and counts the rest", () => {
    const result = sides(
      [
        driver("Pascal Siakam", "O", 2.359),
        driver("Tyrese Haliburton", "O", 2.653),
        driver("Andrew Nembhard", "Q", 0.8),
        driver("Obi Toppin", "O", 0.4),
      ],
      [],
    );
    const home = cardOutSide(result.home)!;
    expect(home.code).toBe("IND");
    expect(home.names.map((name) => name.name)).toEqual(["Haliburton", "Siakam"]);
    expect(home.names[0]).toMatchObject({ athleteId: "id-Tyrese Haliburton", fullName: "Tyrese Haliburton", status: null });
    expect(home.more).toBe(2);
  });

  it("carries a status letter for doubtful and questionable, none for out or counted out", () => {
    const result = sides([driver("Anthony Edwards", "Q", 3.1), driver("Rudy Gobert", "D", 1.0)], [driver("Jalen Johnson", null, 2)]);
    expect(cardOutSide(result.home)!.names.map((name) => [name.name, name.status])).toEqual([
      ["Edwards", "Q"],
      ["Gobert", "D"],
    ]);
    expect(cardOutSide(result.away)!.names[0].status).toBeNull();
  });

  it("never names or counts probable or available players", () => {
    const result = sides([driver("Tyrese Haliburton", "O", 2), driver("Ben Sheppard", "P", 0.03), driver("Obi Toppin", "A", 0.01)], []);
    const home = cardOutSide(result.home)!;
    expect(home.names.map((name) => name.name)).toEqual(["Haliburton"]);
    expect(home.more).toBe(0);
    // A side whose only drivers are probable prints its figure but names nobody.
    expect(cardOutSide(sides([driver("Ben Sheppard", "P", 0.2)], []).home)).toBeNull();
  });

  it("adds a second name only within the character budget", () => {
    const result = sides([driver("Shai Gilgeous-Alexander", "O", 4.1), driver("Jalen Williams", "O", 2)], []);
    const home = cardOutSide(result.home)!;
    expect("Gilgeous-Alexander".length + "Williams".length).toBeGreaterThan(CARD_OUT_CHARS);
    expect(home.names.map((name) => name.name)).toEqual(["Gilgeous-Alexander"]);
    expect(home.more).toBe(1);
  });

  it("drops suffixes and tells teammates with one surname apart", () => {
    const result = sides([driver("Jalen Williams", "O", 2), driver("Jaylin Williams", "O", 1), driver("Larry Nance Jr.", "O", 0.5)], []);
    expect(cardOutSide(result.home)!.names.map((name) => name.name)).toEqual(["J. Williams", "J. Williams"]);
    expect(cardOutSide(sides([driver("Larry Nance Jr.", "O", 1)], []).home)!.names[0].name).toBe("Nance");
  });

  it("shows nothing new for a side with no drivers or below the printed figure", () => {
    const result = sides([], [driver("Jalen Johnson", "O", 0.04)]);
    expect(cardOutSide(result.home)).toBeNull();
    expect(cardOutSide(result.away)).toBeNull();
    expect(cardOutNames(result)).toEqual({});
    expect(cardOutNames(null)).toEqual({});
  });

  it("names only stored drivers on a seal rebuilt from its report, counting the rebuilt rest", () => {
    const report: LiveReport = {
      file: "2026-11-02_06_30PM",
      notSubmitted: [],
      rows: [
        [IND, "Haliburton, Tyrese", "O", "Injury"],
        [IND, "Siakam, Pascal", "O", "Rest"],
        [IND, "Nembhard, Andrew", "O", "Injury"],
        [IND, "Toppin, Obi", "O", "Injury"],
        [IND, "Zubac, Ivica", "Q", "Injury"],
      ],
    };
    const result = sides(
      [driver("Tyrese Haliburton", "O", 2.653), driver("Pascal Siakam", "O", 2.359), driver("Andrew Nembhard", "O", 1.643)],
      [],
      false,
      report,
    );
    const home = cardOutSide(result.home)!;
    expect(home.names.map((name) => name.name)).toEqual(["Haliburton", "Siakam"]);
    // Nembhard (stored) plus Toppin and Zubac (rebuilt from the report).
    expect(home.more).toBe(3);
  });

  it("keys both sides by code and builds the key above the cards", () => {
    const result = sides([driver("Anthony Edwards", "Q", 3)], [driver("Jalen Johnson", "O", 2)]);
    expect(Object.keys(cardOutNames(result)).sort()).toEqual(["ATL", "IND"]);
    expect(cardOutKey([{ absences: result }, { absences: null }])).toEqual({ any: true, statuses: ["Q"] });
    expect(cardOutKey([{ absences: null }])).toEqual({ any: false, statuses: [] });
    const side: AbsenceSide = { ...result.home, points: 0 };
    expect(cardOutKey([{ absences: { home: side, away: { ...result.away, points: 0 } } }]).any).toBe(false);
  });
});
