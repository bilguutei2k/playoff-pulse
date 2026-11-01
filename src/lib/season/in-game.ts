// In-game estimate. Live scores reach only this function; they never change
// ratings or a sealed pregame forecast.
//
// Stern's formula: the rest of the game is treated as a Normal margin whose mean
// and variance scale with the time left. The floor keeps at least one
// possession's worth of variance, and the clamp avoids printing certainty before
// a game is actually over. Mid-quarter values are interpolation: only quarter
// ends have been validated.

import { clampProbability, normalCdf } from "@/lib/season/math";

export const REGULATION_SECONDS = 2880;
const OVERTIME_SECONDS = 300;
const QUARTER_SECONDS = 720;
const MIN_FRACTION = 1 / 48;
const PROBABILITY_FLOOR = 0.005;

export type InGameInput = {
  /** Current home margin (home minus away). */
  homeMargin: number;
  /** Pregame expected home margin. */
  expectedMargin: number;
  /** 1-4 are quarters; 5 and above are overtimes. */
  period: number;
  /** Seconds left in the current period. */
  clockSeconds: number;
  sigma: number;
};

export function secondsRemaining(period: number, clockSeconds: number): number {
  const clock = Math.max(0, clockSeconds);
  if (period > 4) return Math.min(clock, OVERTIME_SECONDS);
  const quartersLeft = Math.max(0, 4 - Math.max(1, period));
  return quartersLeft * QUARTER_SECONDS + Math.min(clock, QUARTER_SECONDS);
}

export function inGameHomeProbability(input: InGameInput): number {
  const fraction = Math.max(
    secondsRemaining(input.period, input.clockSeconds) / REGULATION_SECONDS,
    MIN_FRACTION,
  );
  const probability = normalCdf(
    (input.homeMargin + input.expectedMargin * fraction) /
      (input.sigma * Math.sqrt(fraction)),
  );
  return clampProbability(probability, PROBABILITY_FLOOR);
}
