// "What moves the number": a forecast's expected margin split into the parts the
// model adds up. Every part is a `predictGame` difference over the published ratings
// or a stored field, never a separate formula, and the parts always sum to the total.
// The published ratings are only the seal's ratings when the seal's `ratingsHash`
// matches the state; otherwise rating and home court are reported as one part.

import { predictGame } from "@/lib/season/ratings";
import type { GameContext, LiveState } from "@/lib/season/types";

export type MarginPart = {
  key: "rating" | "home" | "strength" | "rest" | "absences";
  /** Points added to the home team's margin. */
  points: number;
  /** The same to one decimal; the displayed parts add up to the displayed total. */
  display: number;
};

export type MarginBreakdown = {
  parts: MarginPart[];
  /** Expected home margin: the forecast's own number. */
  total: number;
  /** False when rating and home court could not be separated for this number. */
  separated: boolean;
};

const TOLERANCE = 0.05;

export function marginBreakdown(input: {
  state: Pick<LiveState, "ratings" | "params" | "ratingsHash">;
  context: GameContext;
  /** The number to explain: a seal's, a provisional or a projection's expected margin. */
  expectedMargin: number;
  /** Points each side gives up to expected absences, or null for a number without them. */
  absencePoints: { home: number; away: number } | null;
  /** The seal's ratings hash; null for numbers computed from the published ratings. */
  ratingsHash: string | null;
}): MarginBreakdown {
  const { state, context, expectedMargin, absencePoints } = input;
  const plain: GameContext = { ...context, homeOnBackToBack: false, awayOnBackToBack: false };
  const neutral = predictGame(state.ratings, { ...plain, neutral: true }, state.params).expectedMargin;
  const withHome = predictGame(state.ratings, plain, state.params).expectedMargin;
  const withRest = predictGame(state.ratings, context, state.params).expectedMargin;
  const rest = withRest - withHome;
  const absences = absencePoints ? -(absencePoints.home - absencePoints.away) : 0;

  const parts: Array<Omit<MarginPart, "display">> = [];
  const sameRatings = input.ratingsHash === null || input.ratingsHash === state.ratingsHash;
  const exact = sameRatings && Math.abs(withRest + absences - expectedMargin) <= TOLERANCE;
  if (exact) {
    // The rating part takes the sub-tolerance remainder so the parts sum exactly.
    const home = context.neutral ? 0 : withHome - neutral;
    parts.push({ key: "rating", points: expectedMargin - home - rest - absences });
    if (!context.neutral) parts.push({ key: "home", points: home });
  } else {
    // The remainder is exact: rest uses a frozen parameter, absences are stored.
    parts.push({ key: "strength", points: expectedMargin - rest - absences });
  }
  if (context.homeOnBackToBack || context.awayOnBackToBack) parts.push({ key: "rest", points: rest });
  if (absencePoints) parts.push({ key: "absences", points: absences });
  return { parts: withDisplay(parts, expectedMargin), total: expectedMargin, separated: exact };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Rounds every part but the first, which takes whatever makes the sum match the total. */
function withDisplay(parts: Array<Omit<MarginPart, "display">>, total: number): MarginPart[] {
  const rest = parts.slice(1).map((part) => ({ ...part, display: round1(part.points) }));
  const first = parts[0];
  const used = rest.reduce((sum, part) => sum + part.display, 0);
  return [{ ...first, display: round1(round1(total) - used) }, ...rest];
}
