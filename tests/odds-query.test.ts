import { describe, expect, it } from "vitest";
import { ODDS_DEFAULT, parseOddsQuery, serializeOddsQuery, type OddsQuery } from "@/app/odds/query";

describe("odds table query", () => {
  it("keeps the plain route for the default view", () => {
    expect(serializeOddsQuery(ODDS_DEFAULT)).toBe("");
    expect(parseOddsQuery("")).toEqual(ODDS_DEFAULT);
  });

  it("round-trips a conference and a sort", () => {
    const cases: OddsQuery[] = [
      { view: "West", sort: ODDS_DEFAULT.sort },
      { view: "League", sort: { key: "champion", descending: true } },
      { view: "East", sort: { key: "team", descending: false } },
      { view: "East", sort: { key: "team", descending: true } },
      { view: "West", sort: { key: "projectedWins", descending: false } },
      { view: "League", sort: { key: "ratingNow", descending: false } },
    ];
    for (const query of cases) expect(parseOddsQuery(serializeOddsQuery(query))).toEqual(query);
  });

  it("writes readable links and omits a column's own default direction", () => {
    expect(serializeOddsQuery({ view: "West", sort: { key: "champion", descending: true } })).toBe("?conf=west&sort=title");
    expect(serializeOddsQuery({ view: "East", sort: { key: "team", descending: false } })).toBe("?sort=team");
    expect(serializeOddsQuery({ view: "League", sort: { key: "makePlayoffs", descending: false } })).toBe(
      "?conf=all&sort=playoffs&dir=asc",
    );
  });

  it("falls back to defaults on anything unknown", () => {
    expect(parseOddsQuery("?conf=north&sort=height&dir=up")).toEqual(ODDS_DEFAULT);
    expect(parseOddsQuery("?conf=WEST&sort=Title")).toEqual({ view: "West", sort: { key: "champion", descending: true } });
  });
});
