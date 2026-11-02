import { describe, expect, it } from "vitest";
import {
  DARK_LIGHTNESS,
  MIN_COLOR_DISTANCE,
  MIN_MARK_CONTRAST,
  NEUTRAL_TEAM_COLOR,
  colorDistance,
  contrastRatio,
  distinctTeamColors,
  lightness,
  teamDisplayColor,
  teamPairColors,
  tooClose,
} from "@/lib/season/team-colors";
import { SEASON_TEAMS } from "@/lib/season/teams";

const WHITE = "#ffffff";
const id = (abbreviation: string) => {
  const team = SEASON_TEAMS.find((row) => row.abbreviation === abbreviation);
  if (!team) throw new Error(abbreviation);
  return team.id;
};

describe("team colors", () => {
  it("stores a six-digit hex primary and alternate for every team", () => {
    expect(SEASON_TEAMS).toHaveLength(30);
    for (const team of SEASON_TEAMS) {
      expect(team.color).toMatch(/^[0-9a-f]{6}$/);
      expect(team.alternateColor).toMatch(/^[0-9a-f]{6}$/);
    }
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("ffffff", "ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio(NEUTRAL_TEAM_COLOR, WHITE)).toBeGreaterThan(4.5);
  });

  it("uses the primary when it is visible", () => {
    expect(teamDisplayColor(id("BOS"), WHITE)).toBe("#008348");
  });

  it("falls back to the alternate when the primary is too light", () => {
    // Golden State's gold is about 1.7:1 on white; its navy alternate is not.
    expect(contrastRatio("#fdb927", WHITE)).toBeLessThan(MIN_MARK_CONTRAST);
    expect(teamDisplayColor(id("GS"), WHITE)).toBe("#1d428a");
  });

  it("falls back to the neutral when neither color is visible", () => {
    // Brooklyn is black and white, so on a black surface only the white shows, and
    // on a white surface only the black.
    expect(teamDisplayColor(id("BKN"), "#000000")).toBe("#ffffff");
    expect(teamDisplayColor(id("BKN"), WHITE)).toBe("#000000");
    // Golden State's gold and navy both fail on a mid-blue background.
    expect(teamDisplayColor(id("GS"), "#1d428a")).toBe("#fdb927");
    expect(teamDisplayColor(id("DEN"), "#ffd84a")).toBe("#0e2240");
    expect(teamDisplayColor(id("UTAH"), "#6b3fa0")).toBe(NEUTRAL_TEAM_COLOR);
  });

  it("switches one team to its alternate when the pair is too close", () => {
    // New York and Detroit share the same blue.
    const [knicks, pistons] = teamPairColors(id("NY"), id("DET"), WHITE);
    expect(knicks).toBe("#1d428a");
    expect(pistons).toBe("#c8102e");
    expect(colorDistance(knicks, pistons)).toBeGreaterThanOrEqual(MIN_COLOR_DISTANCE);
  });

  it("keeps both primaries when they are already distinct", () => {
    expect(teamPairColors(id("BOS"), id("LAL"), WHITE)).toEqual(["#008348", "#552583"]);
  });

  it("switches the first team when the second has no usable alternate", () => {
    // Indiana and Denver are both navy; Denver's gold and Indiana's yellow fail on
    // white, so one side ends up neutral rather than two identical navies.
    const [pacers, nuggets] = teamPairColors(id("IND"), id("DEN"), WHITE);
    expect(colorDistance(pacers, nuggets)).toBeGreaterThanOrEqual(MIN_COLOR_DISTANCE);
    expect([pacers, nuggets]).toContain(NEUTRAL_TEAM_COLOR);
  });

  it("gives every pairing of the league two visible, distinct colors", () => {
    for (const first of SEASON_TEAMS) {
      for (const second of SEASON_TEAMS) {
        if (first.id === second.id) continue;
        const [a, b] = teamPairColors(first.id, second.id, WHITE);
        expect(contrastRatio(a, WHITE)).toBeGreaterThanOrEqual(MIN_MARK_CONTRAST);
        expect(contrastRatio(b, WHITE)).toBeGreaterThanOrEqual(MIN_MARK_CONTRAST);
        expect(colorDistance(a, b)).toBeGreaterThanOrEqual(MIN_COLOR_DISTANCE);
        expect(tooClose(a, b)).toBe(false);
      }
    }
  });

  it("treats two near-black colors as too close even when their distance clears the floor", () => {
    // Brooklyn's black and Indiana's navy are 26 apart in OKLab but blur in a thin bar.
    expect(colorDistance("#000000", "#0c2340")).toBeGreaterThan(MIN_COLOR_DISTANCE);
    expect(lightness("#0c2340")).toBeLessThan(DARK_LIGHTNESS);
    expect(tooClose("#000000", "#0c2340")).toBe(true);
    const [nets, pacers] = teamPairColors(id("BKN"), id("IND"), WHITE);
    expect(tooClose(nets, pacers)).toBe(false);
  });

  it("assigns chart colors in order, avoiding colors already used", () => {
    const colors = distinctTeamColors([id("NY"), id("DET"), id("PHI")], WHITE);
    expect(colors[id("NY")]).toBe("#1d428a");
    expect(colors[id("DET")]).toBe("#c8102e");
    expect(colors[id("PHI")]).not.toBe("#1d428a");
    for (const color of Object.values(colors)) {
      expect(contrastRatio(color, WHITE)).toBeGreaterThanOrEqual(MIN_MARK_CONTRAST);
    }
  });
});
