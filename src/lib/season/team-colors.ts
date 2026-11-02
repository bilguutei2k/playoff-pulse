// Picks team colors that stay visible on a given background and distinct from the
// other team in the same mark. Display only: colors never carry meaning alone,
// because logos and abbreviations always sit beside every colored mark.

import { teamById } from "@/lib/season/teams";

/** WCAG contrast a non-text mark needs against its background. */
export const MIN_MARK_CONTRAST = 3;
/**
 * Two colors closer than this (OKLab distance x100) read as the same color to
 * full-color readers. It is the normal-vision floor of the dataviz palette check.
 */
export const MIN_COLOR_DISTANCE = 15;
/** Used when neither team color is visible on the background. Gray 500, 4.8:1 on white. */
export const NEUTRAL_TEAM_COLOR = "#6b7280";
/**
 * A second neutral for the rare pair where one team's only visible color sits too
 * close to the mid gray, such as two mid blues. Gray 800, 14.7:1 on white.
 */
export const DARK_NEUTRAL_TEAM_COLOR = "#1f2937";
const NEUTRALS = [NEUTRAL_TEAM_COLOR, DARK_NEUTRAL_TEAM_COLOR];
/**
 * OKLab lightness below which a color reads as near-black in a thin mark. Two such
 * colors (black beside navy, say) blur together even when their distance clears the
 * floor, so they also count as too close.
 */
export const DARK_LIGHTNESS = 0.36;

function normalizeHex(hex: string): string {
  const value = hex.trim().replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(value)) throw new Error(`Not a six-digit hex color: ${hex}`);
  return `#${value}`;
}

function channels(hex: string): [number, number, number] {
  const value = normalizeHex(hex);
  return [1, 3, 5].map((start) => parseInt(value.slice(start, start + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two hex colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Perceptual distance between two colors: Euclidean OKLab distance x100. */
export function colorDistance(a: string, b: string): number {
  const first = toOklab(a);
  const second = toOklab(b);
  return 100 * Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

/** OKLab lightness, 0 for black to 1 for white. */
export function lightness(hex: string): number {
  return toOklab(hex)[0];
}

/** True when two colors are hard to tell apart in a thin mark. */
export function tooClose(a: string, b: string): boolean {
  if (colorDistance(a, b) < MIN_COLOR_DISTANCE) return true;
  return lightness(a) < DARK_LIGHTNESS && lightness(b) < DARK_LIGHTNESS;
}

function visible(color: string, background: string): boolean {
  return contrastRatio(color, background) >= MIN_MARK_CONTRAST;
}

function distinct(color: string, others: readonly string[]): boolean {
  return others.every((other) => !tooClose(color, other));
}

/** The team's colors that are visible on the background, in preference order. */
function candidates(teamId: string, background: string): string[] {
  const team = teamById(teamId);
  const options = [
    normalizeHex(team.color),
    normalizeHex(team.alternateColor),
    NEUTRAL_TEAM_COLOR,
    DARK_NEUTRAL_TEAM_COLOR,
  ].filter((color) => visible(color, background));
  // On a surface where every option fails, still return something drawable.
  return options.length > 0 ? [...new Set(options)] : [NEUTRAL_TEAM_COLOR];
}

/**
 * A display color for one team on a background: the primary if it reaches 3:1,
 * else the alternate if that does, else a neutral gray. Returned as `#rrggbb`.
 */
export function teamDisplayColor(teamId: string, background: string): string {
  return candidates(teamId, normalizeHex(background))[0];
}

/**
 * Colors for the two sides of one bar. Each team starts from its display color; if
 * the two are too close to tell apart (see `tooClose`), the second team switches to its alternate,
 * then the first team does, then one side falls back to a neutral. Among equally
 * small changes, changing the second team is preferred.
 */
export function teamPairColors(
  firstId: string,
  secondId: string,
  background: string,
): [string, string] {
  const surface = normalizeHex(background);
  const first = candidates(firstId, surface);
  const second = candidates(secondId, surface);
  const pairs: Array<{ colors: [string, string]; cost: number; firstStep: number }> = [];
  first.forEach((a, i) =>
    second.forEach((b, j) => pairs.push({ colors: [a, b], cost: i + j, firstStep: i })),
  );
  pairs.sort((x, y) => x.cost - y.cost || x.firstStep - y.firstStep);
  const found = pairs.find(({ colors: [a, b] }) => !tooClose(a, b));
  return (found ?? pairs[0]).colors;
}

function fromLinear(channel: number): number {
  const clipped = Math.min(1, Math.max(0, channel));
  return clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
}

function fromOklab([lightness, a, b]: [number, number, number]): string {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${rgb
    .map((channel) => Math.round(fromLinear(channel) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Lightness steps for a team's own shades when both its colors are taken, nearest first. */
const SHADE_STEPS = [-0.14, 0.14, -0.24, 0.24];
const SHADE_MIN_LIGHTNESS = 0.3;
const SHADE_MAX_LIGHTNESS = 0.8;

/** Darker, then lighter, versions of a team's colors: same hue, still that team's color. */
function shades(teamId: string, background: string): string[] {
  const team = teamById(teamId);
  const output: string[] = [];
  for (const base of [team.color, team.alternateColor]) {
    const [lightness, a, b] = toOklab(normalizeHex(base));
    for (const step of SHADE_STEPS) {
      const next = lightness + step;
      // Near-black shades read as axis ink, not as a team.
      if (next < SHADE_MIN_LIGHTNESS || next > SHADE_MAX_LIGHTNESS) continue;
      output.push(fromOklab([next, a, b]));
    }
  }
  return output.filter((color) => visible(color, background));
}

/**
 * Colors for several teams in one chart, in the given order (pass the most prominent
 * team first). Each team takes its primary or alternate if that is visible and
 * distinct from every color already assigned. Teams left over then take a darker or
 * lighter shade of their own colors, then a neutral; if nothing is distinct, a team
 * takes whichever option sits farthest from the colors already used, and the legend,
 * hover and table view carry its identity.
 */
export function distinctTeamColors(
  teamIds: readonly string[],
  background: string,
): Record<string, string> {
  const surface = normalizeHex(background);
  const assigned: Record<string, string> = {};
  const used: string[] = [];
  const tiers: Array<(teamId: string) => string[]> = [
    (teamId) => candidates(teamId, surface).filter((color) => !NEUTRALS.includes(color)),
    (teamId) => shades(teamId, surface),
    (teamId) => candidates(teamId, surface).filter((color) => NEUTRALS.includes(color)),
  ];
  let remaining = [...teamIds];
  for (const options of tiers) {
    remaining = remaining.filter((teamId) => {
      const color = options(teamId).find((option) => distinct(option, used));
      if (!color) return true;
      assigned[teamId] = color;
      used.push(color);
      return false;
    });
  }
  // Nothing is fully distinct: take the option farthest from the colors already used.
  for (const teamId of remaining) {
    const options = [...tiers[0](teamId), ...tiers[1](teamId), ...tiers[2](teamId)];
    const nearest = (color: string) =>
      Math.min(Number.POSITIVE_INFINITY, ...used.map((other) => colorDistance(color, other)));
    const color =
      options.sort((a, b) => nearest(b) - nearest(a))[0] ?? teamDisplayColor(teamId, surface);
    assigned[teamId] = color;
    used.push(color);
  }
  return assigned;
}
