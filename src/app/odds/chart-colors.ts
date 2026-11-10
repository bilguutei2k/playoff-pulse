// Line styles for the title-odds chart (VA-14, DS-13). Display only.
//
// Each team draws in one of its own two colors when that color is visible on the
// panel, is not near the axis ink (so no team reads as the axis), and is not too
// close to a color already used (`tooClose`, the same test the pair bars use).
// A team with no such color takes the shared neutral gray if that is still free;
// otherwise it keeps the option farthest from the colors already used and gets a
// dash pattern as a second channel. Colors are never invented, and the end labels
// name every line directly, so color is never the only key.

import { teamById } from "@/lib/season/teams";
import {
  MIN_MARK_CONTRAST,
  NEUTRAL_TEAM_COLOR,
  colorDistance,
  contrastRatio,
  tooClose,
} from "@/lib/season/team-colors";

/** --color-ink in styles/base.css: the chart's zero line and axis. */
export const CHART_AXIS_INK = "#111111";
/** --color-line in styles/base.css: the grey lines of the other teams. */
export const CHART_TRACK = "#dcdcdc";

/**
 * Dash patterns for lines whose color is shared, preferred first: dash, dot,
 * dash-dot, long dash, dot-dot-dash, then a short even dash for the rare eighth.
 * Seven patterns plus solid cover any eight-team chart.
 */
export const CHART_DASHES = ["8 4", "2 3", "12 3 2 3", "18 4", "2 3 2 3 8 3", "4 3", "1 5"] as const;

export type ChartLineStyle = { color: string; dash: string | null };

function normalize(hex: string): string {
  return `#${hex.trim().replace(/^#/, "").toLowerCase()}`;
}

const usable = (background: string) => (color: string) =>
  contrastRatio(color, background) >= MIN_MARK_CONTRAST && !tooClose(color, CHART_AXIS_INK);

/** The team's own colors that can draw a line here, primary first. */
function teamColors(teamId: string, background: string): string[] {
  const team = teamById(teamId);
  return [...new Set([normalize(team.color), normalize(team.alternateColor)])].filter(usable(background));
}

/**
 * Styles for the chart's highlighted teams, most prominent first (earlier teams keep
 * their first choice). Solid lines are pairwise distinct and none is near the axis
 * ink; a dashed line's pattern differs from every other dashed line's while there
 * are at most CHART_DASHES.length of them.
 */
export function titleChartStyles(
  teamIds: readonly string[],
  background = "#ffffff",
): Record<string, ChartLineStyle> {
  const surface = normalize(background);
  const reserved = [CHART_AXIS_INK, CHART_TRACK];
  const used: string[] = [];
  const styles: Record<string, ChartLineStyle> = {};
  const isFree = (color: string) => [...reserved, ...used].every((other) => !tooClose(color, other));
  // 1. Every team that can keeps one of its own colors, solid.
  // 2. Teams left over take the neutral gray, solid, while it is free.
  const tiers: Array<(teamId: string) => string[]> = [
    (teamId) => teamColors(teamId, surface),
    () => (usable(surface)(NEUTRAL_TEAM_COLOR) ? [NEUTRAL_TEAM_COLOR] : []),
  ];
  // The most prominent team is always solid, in its first usable color or the gray.
  const [first, ...rest] = teamIds;
  if (first !== undefined) {
    const color = [...teamColors(first, surface), NEUTRAL_TEAM_COLOR].find(isFree) ?? NEUTRAL_TEAM_COLOR;
    styles[first] = { color, dash: null };
    used.push(color);
  }
  let remaining = rest;
  for (const choices of tiers) {
    remaining = remaining.filter((teamId) => {
      const color = choices(teamId).find(isFree);
      if (!color) return true;
      styles[teamId] = { color, dash: null };
      used.push(color);
      return false;
    });
  }
  // 3. The rest keep a color of their own (or the gray) with a dash pattern no line
  //    of a close color already has; among those, the color farthest from the rest.
  for (const teamId of remaining) {
    const nearest = (color: string) =>
      Math.min(Number.POSITIVE_INFINITY, ...used.map((other) => colorDistance(color, other)));
    const uses = (pattern: string) => Object.values(styles).filter((style) => style.dash === pattern).length;
    const options = [...new Set([...teamColors(teamId, surface), NEUTRAL_TEAM_COLOR])].map((color) => {
      const taken = new Set(
        Object.values(styles)
          .filter((style) => tooClose(style.color, color))
          .map((style) => style.dash),
      );
      // Least used first, so the patterns spread out; stable for equal counts.
      const open = CHART_DASHES.filter((pattern) => !taken.has(pattern)).sort((a, b) => uses(a) - uses(b));
      return { color, dash: open[0] ?? null, distance: nearest(color) };
    });
    options.sort((a, b) => Number(b.dash !== null) - Number(a.dash !== null) || b.distance - a.distance);
    const pick = options[0];
    styles[teamId] = { color: pick.color, dash: pick.dash ?? CHART_DASHES[0] };
    used.push(pick.color);
  }
  return styles;
}
