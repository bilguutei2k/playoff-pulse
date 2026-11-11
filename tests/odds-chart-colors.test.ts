import { describe, expect, it } from "vitest";
import { CHART_AXIS_INK, CHART_DASHES, titleChartStyles } from "@/app/odds/chart-colors";
import { MIN_MARK_CONTRAST, contrastRatio, tooClose } from "@/lib/season/team-colors";
import { SEASON_TEAMS } from "@/lib/season/teams";
import { teamDisplay } from "@/lib/view/teams";

const WHITE = "#ffffff";
const byCode = (code: string) => {
  const team = SEASON_TEAMS.find((row) => teamDisplay(row.id).code === code);
  if (!team) throw new Error(code);
  return team.id;
};

/** Deterministic eight-team samples (a small LCG), so the check is repeatable. */
function samples(count: number): string[][] {
  let seed = 548;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const ids = SEASON_TEAMS.map((team) => team.id);
  return Array.from({ length: count }, () => {
    const pool = [...ids];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 8);
  });
}

describe("title chart line styles", () => {
  const sets = [
    ["OKC", "SAS", "NYK", "BOS", "HOU", "DET", "MIN", "LAL"].map(byCode),
    ...samples(400),
  ];

  it("never draws a team in the axis ink or an invisible color", () => {
    for (const set of sets) {
      for (const style of Object.values(titleChartStyles(set, WHITE))) {
        expect(tooClose(style.color, CHART_AXIS_INK)).toBe(false);
        expect(contrastRatio(style.color, WHITE)).toBeGreaterThanOrEqual(MIN_MARK_CONTRAST);
      }
    }
  });

  it("keeps every pair of lines apart by color or by dash pattern", () => {
    for (const set of sets) {
      const styles = titleChartStyles(set, WHITE);
      const list = set.map((id) => styles[id]);
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          if (tooClose(list[i].color, list[j].color)) expect(list[i].dash).not.toBe(list[j].dash);
        }
      }
    }
  });

  it("gives the most prominent team its own color, solid, and only uses known dashes", () => {
    for (const set of sets) {
      const styles = titleChartStyles(set, WHITE);
      expect(styles[set[0]].dash).toBeNull();
      for (const style of Object.values(styles)) {
        if (style.dash !== null) expect(CHART_DASHES).toContain(style.dash);
      }
    }
  });

  it("separates the November 2026 top eight: Spurs not black, Pistons not Rockets red", () => {
    const styles = titleChartStyles(sets[0], WHITE);
    expect(styles[byCode("SAS")].color).not.toBe("#000000");
    const pistons = styles[byCode("DET")];
    const rockets = styles[byCode("HOU")];
    expect(pistons.color === rockets.color && pistons.dash === rockets.dash).toBe(false);
    expect(titleChartStyles(sets[0], WHITE)).toEqual(styles);
  });
});
