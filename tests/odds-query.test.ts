import { describe, expect, it } from "vitest";
import { ODDS_DEFAULT, parseOddsQuery, serializeOddsQuery, type OddsQuery } from "@/app/odds/query";
import { teamBySlug } from "@/lib/view/teams";

describe("odds table query", () => {
  it("keeps the plain route for the default view", () => {
    expect(serializeOddsQuery(ODDS_DEFAULT)).toBe("");
    expect(parseOddsQuery("")).toEqual(ODDS_DEFAULT);
  });

  it("round-trips a conference and a sort", () => {
    const cases: Array<Omit<OddsQuery, "chart">> = [
      { view: "West", sort: ODDS_DEFAULT.sort },
      { view: "League", sort: { key: "champion", descending: true } },
      { view: "East", sort: { key: "team", descending: false } },
      { view: "East", sort: { key: "team", descending: true } },
      { view: "West", sort: { key: "projectedWins", descending: false } },
      { view: "League", sort: { key: "ratingNow", descending: false } },
    ];
    for (const partial of cases) {
      const query: OddsQuery = { ...partial, chart: ODDS_DEFAULT.chart };
      expect(parseOddsQuery(serializeOddsQuery(query))).toEqual(query);
    }
  });

  it("writes readable links and omits a column's own default direction", () => {
    expect(serializeOddsQuery({ ...ODDS_DEFAULT, view: "West", sort: { key: "champion", descending: true } })).toBe("?conf=west&sort=title");
    expect(serializeOddsQuery({ ...ODDS_DEFAULT, view: "East", sort: { key: "team", descending: false } })).toBe("?sort=team");
    expect(serializeOddsQuery({ ...ODDS_DEFAULT, view: "League", sort: { key: "makePlayoffs", descending: false } })).toBe(
      "?conf=all&sort=playoffs&dir=asc",
    );
  });

  it("falls back to defaults on anything unknown", () => {
    expect(parseOddsQuery("?conf=north&sort=height&dir=up")).toEqual(ODDS_DEFAULT);
    expect(parseOddsQuery("?conf=WEST&sort=Title")).toEqual({ ...ODDS_DEFAULT, view: "West", sort: { key: "champion", descending: true } });
  });

  it("keeps the chart's measure and team beside the table's keys", () => {
    const celtics = teamBySlug("bos")!.id;
    const query: OddsQuery = { view: "West", sort: ODDS_DEFAULT.sort, chart: { measure: "makePlayoffs", team: celtics } };
    expect(serializeOddsQuery(query)).toBe("?conf=west&measure=playoffs&team=bos");
    expect(parseOddsQuery("?conf=west&measure=playoffs&team=bos")).toEqual(query);
    expect(parseOddsQuery("?measure=wins").chart).toEqual({ measure: "projectedWins", team: null });
    expect(parseOddsQuery("?measure=height&team=nowhere").chart).toEqual(ODDS_DEFAULT.chart);
    expect(serializeOddsQuery({ ...ODDS_DEFAULT, chart: { measure: "champion", team: null } })).toBe("");
  });
});
