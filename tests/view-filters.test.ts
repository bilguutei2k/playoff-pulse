// URL filter state for the injuries and players pages (src/lib/view/filters.ts), the days
// row's date control (src/lib/view/day-nav.ts) and the drawer's focus trap arithmetic
// (src/lib/utils/focus.ts).
import { describe, expect, it } from "vitest";
import { nextFocusIndex } from "@/lib/utils/focus";
import { dayHref, jumpDate } from "@/lib/view/day-nav";
import {
  INJURIES_DEFAULT,
  injuriesHref,
  parseInjuriesQuery,
  parsePlayersQuery,
  serializeInjuriesQuery,
  serializePlayersQuery,
  type PlayersQuery,
  type PlayersQueryOptions,
} from "@/lib/view/filters";

const teams = [
  { id: "8", code: "DET" },
  { id: "13", code: "LAL" },
];

describe("injuries query", () => {
  it("round-trips a team and a status, as codes and words", () => {
    const query = { team: "8", status: "O" as const };
    expect(serializeInjuriesQuery(query, teams)).toBe("?team=DET&status=out");
    expect(parseInjuriesQuery("?team=DET&status=out", teams)).toEqual(query);
    expect(parseInjuriesQuery("?team=det&status=OUT", teams)).toEqual(query);
    expect(parseInjuriesQuery("?status=missed", teams)).toEqual({ team: "all", status: "missed" });
  });

  it("writes nothing for the defaults and reads the defaults from anything malformed", () => {
    expect(serializeInjuriesQuery(INJURIES_DEFAULT, teams)).toBe("");
    expect(parseInjuriesQuery("", teams)).toEqual(INJURIES_DEFAULT);
    expect(parseInjuriesQuery("?team=XXX&status=hurt", teams)).toEqual(INJURIES_DEFAULT);
    expect(parseInjuriesQuery("?team=8", teams)).toEqual(INJURIES_DEFAULT);
    expect(parseInjuriesQuery("?%E0%A4%A", teams)).toEqual(INJURIES_DEFAULT);
    expect(serializeInjuriesQuery({ team: "999", status: "all" }, teams)).toBe("");
  });

  it("links a team's list by its code", () => {
    expect(injuriesHref("8")).toBe("/injuries?team=DET");
  });
});

describe("players query", () => {
  const defaults: PlayersQuery = { q: "", min: 10, team: "all", sort: "points", desc: true };
  const options: PlayersQueryOptions = {
    sortKeys: ["name", "team", "points", "minutes", "impact", "status"],
    minutes: [0, 10, 20, 30],
    teams,
    defaultDescending: (key) => !(key === "name" || key === "team" || key === "status"),
  };
  const parse = (search: string) => parsePlayersQuery(search, defaults, options);
  const write = (query: Partial<PlayersQuery>) => serializePlayersQuery({ ...defaults, ...query }, defaults, options);

  it("round-trips search, minutes, team and sort", () => {
    const query: PlayersQuery = { q: "Dončić", min: 20, team: "13", sort: "minutes", desc: true };
    const search = write(query);
    expect(search).toBe("?q=Don%C4%8Di%C4%87&min=20&team=LAL&sort=minutes");
    expect(parse(search)).toEqual(query);
  });

  it("writes only what differs from the defaults", () => {
    expect(write({})).toBe("");
    expect(write({ min: 0 })).toBe("?min=0");
    expect(write({ sort: "points", desc: false })).toBe("?sort=points&dir=asc");
    expect(write({ sort: "name" })).toBe("?sort=name&dir=desc");
    expect(write({ sort: "name", desc: false })).toBe("?sort=name");
    expect(write({ q: "  " })).toBe("");
  });

  it("reads a sort's implied direction, and an explicit one", () => {
    expect(parse("?sort=name")).toMatchObject({ sort: "name", desc: false });
    expect(parse("?sort=impact")).toMatchObject({ sort: "impact", desc: true });
    expect(parse("?sort=impact&dir=asc")).toMatchObject({ sort: "impact", desc: false });
    expect(parse("?dir=asc")).toMatchObject({ sort: "points", desc: false });
  });

  it("falls back silently on unknown or malformed values", () => {
    expect(parse("?min=15&team=NOPE&sort=height&dir=sideways")).toEqual(defaults);
    expect(parse("?min=abc")).toEqual(defaults);
    expect(parse("garbage")).toEqual(defaults);
    expect(parse(`?q=${"x".repeat(100)}`).q).toHaveLength(40);
  });
});

describe("days row", () => {
  it("sends today to the homepage and other days to their archive page", () => {
    expect(dayHref("2026-11-08", "2026-11-08")).toBe("/");
    expect(dayHref("2026-11-07", "2026-11-08")).toBe("/games/2026-11-07");
  });

  it("accepts only a real date inside the stored season", () => {
    expect(jumpDate("2026-11-01", "2026-10-21", "2027-04-12")).toBe("2026-11-01");
    expect(jumpDate("2026-10-21", "2026-10-21", "2027-04-12")).toBe("2026-10-21");
    expect(jumpDate("2027-04-13", "2026-10-21", "2027-04-12")).toBeNull();
    expect(jumpDate("0002-11-08", "2026-10-21", "2027-04-12")).toBeNull();
    expect(jumpDate("2026-02-30", "2026-10-21", "2027-04-12")).toBeNull();
    expect(jumpDate("", "2026-10-21", "2027-04-12")).toBeNull();
  });
});

describe("focus trap", () => {
  it("cycles forwards and backwards and enters from the dialog itself", () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 2, false)).toBe(0);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
    expect(nextFocusIndex(3, 1, true)).toBe(0);
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
  });
});
