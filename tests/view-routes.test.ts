import { describe, expect, it } from "vitest";
import { SEASON_TEAMS } from "@/lib/season/teams";
import { gameHref, playerHref, SITE_URL, teamHref } from "@/lib/view/routes";
import { TEAM_NAME_EM } from "@/lib/view/team-name-widths";
import { teamDisplay } from "@/lib/view/teams";

const id = (abbreviation: string) => SEASON_TEAMS.find((team) => team.abbreviation === abbreviation)!.id;

describe("route helpers", () => {
  it("builds team, game and player paths", () => {
    expect(teamHref(id("MIN"))).toBe("/teams/min");
    expect(teamHref(id("UTAH"))).toBe("/teams/utah");
    expect(gameHref("401809960")).toBe("/game/401809960");
    expect(playerHref("3945274")).toBe("/players/3945274");
    expect(SITE_URL.endsWith("/")).toBe(false);
  });
});

describe("team place", () => {
  it("is the name without the nickname", () => {
    expect(teamDisplay(id("POR")).place).toBe("Portland");
    expect(teamDisplay(id("OKC")).place).toBe("Oklahoma City");
    expect(teamDisplay(id("LAC")).place).toBe("LA");
    expect(teamDisplay(id("PHI")).place).toBe("Philadelphia");
  });
});

describe("team name widths for TeamLink auto", () => {
  it("has a row for every team, with positive widths and the full name widest", () => {
    expect(Object.keys(TEAM_NAME_EM).sort()).toEqual(SEASON_TEAMS.map((team) => team.id).sort());
    for (const [full, short, code] of Object.values(TEAM_NAME_EM)) {
      expect(code).toBeGreaterThan(1);
      expect(short).toBeGreaterThan(1);
      expect(full).toBeGreaterThanOrEqual(short);
    }
  });
});
