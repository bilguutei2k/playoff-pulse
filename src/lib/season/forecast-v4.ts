// v4, M5: the game probability and its noise scale (docs/live/registration-v4.md). Pure.
//
// P(home) = E_a[ Phi( mu(a) / (c_t * sqrt(sigma^2 + v(a))) ) ], the expectation over the
// availability a of players listed Questionable or Doubtful: exact enumeration up to six
// such players in a game, else 256 seeded draws. c_t is the one-parameter probit scale
// that maximises the win/loss likelihood of the last 3,000 regular-season games before the
// game's ET date (1 until 1,000 exist), estimated from outcomes, never from residuals.

import { createSeededRandom } from "@/lib/model/random";
import { clampProbability, normalCdf } from "@/lib/season/math";

/** One availability configuration: its probability, expected margin and sqrt(sigma^2 + v). */
export type Component = { weight: number; mu: number; sd: number };

export function mixtureProbability(components: readonly Component[], scale: number): number {
  let p = 0;
  for (const component of components) p += component.weight * normalCdf(component.mu / (scale * component.sd));
  return clampProbability(p);
}

export type UncertainPlayer = { key: string; pOut: number };

/**
 * The configurations of who plays: every subset when at most `upTo` players are uncertain,
 * else `draws` seeded draws of equal weight. `present[i]` says whether player i plays.
 */
export function availabilityConfigurations(
  players: readonly UncertainPlayer[],
  seed: string,
  upTo: number,
  draws: number,
): Array<{ weight: number; present: boolean[] }> {
  const count = players.length;
  if (count <= upTo) {
    const out: Array<{ weight: number; present: boolean[] }> = [];
    for (let mask = 0; mask < 1 << count; mask += 1) {
      let weight = 1;
      const present: boolean[] = [];
      for (let index = 0; index < count; index += 1) {
        const plays = (mask & (1 << index)) === 0;
        present.push(plays);
        weight *= plays ? 1 - players[index].pOut : players[index].pOut;
      }
      if (weight > 0) out.push({ weight, present });
    }
    return out;
  }
  const random = createSeededRandom(seed);
  const out: Array<{ weight: number; present: boolean[] }> = [];
  for (let draw = 0; draw < draws; draw += 1) {
    out.push({ weight: 1 / draws, present: players.map((player) => random() >= player.pOut) });
  }
  return out;
}

export type ScaleEntry = { components: readonly Component[]; y: 0 | 1 };

const INV_SQRT_2PI = 0.3989422804014327;

/**
 * The probit scale c maximising sum log P(y | c) over the window, by Newton's method on
 * t = 1/c from the previous value, kept within [0.25, 4]. Deterministic.
 */
export function estimateScale(window: readonly ScaleEntry[], previous: number): number {
  let t = 1 / previous;
  const evaluate = (value: number) => {
    let l = 0;
    let d1 = 0;
    let d2 = 0;
    for (const entry of window) {
      let p = 0;
      let dp = 0;
      let ddp = 0;
      for (const component of entry.components) {
        const z = component.mu / component.sd;
        const x = value * z;
        const density = INV_SQRT_2PI * Math.exp(-0.5 * x * x);
        p += component.weight * normalCdf(x);
        dp += component.weight * density * z;
        ddp -= component.weight * density * value * z * z * z;
      }
      if (entry.y === 0) {
        p = 1 - p;
        dp = -dp;
        ddp = -ddp;
      }
      p = Math.max(p, 1e-12);
      l += Math.log(p);
      d1 += dp / p;
      d2 += ddp / p - (dp / p) * (dp / p);
    }
    return { l, d1, d2 };
  };
  let current = evaluate(t);
  for (let step = 0; step < 50; step += 1) {
    let proposal = current.d2 < 0 ? t - current.d1 / current.d2 : t + Math.sign(current.d1) * 0.05;
    proposal = Math.min(4, Math.max(0.25, proposal));
    let next = evaluate(proposal);
    let halvings = 0;
    while (next.l < current.l && halvings < 30) {
      proposal = (proposal + t) / 2;
      next = evaluate(proposal);
      halvings += 1;
    }
    const moved = Math.abs(proposal - t);
    t = proposal;
    current = next;
    if (moved < 1e-10) break;
  }
  return 1 / t;
}
