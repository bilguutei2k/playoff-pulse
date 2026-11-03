// Turns a market line into a win probability for display beside the model's number.
// Reference only: market data is never a model input, and no claim is made about the
// model against the market until a large prospective sample exists.

import type { MarketReference } from "@/lib/season/types";

/**
 * Implied probability of one American moneyline, vig still included. Lines between
 * -100 and +100 are not valid American odds, so they return null.
 */
function moneylineProbability(moneyline: number): number | null {
  if (!Number.isFinite(moneyline) || Math.abs(moneyline) < 100) return null;
  if (moneyline > 0) return 100 / (moneyline + 100);
  const stake = Math.abs(moneyline);
  return stake / (stake + 100);
}

/**
 * The market's home win probability with the vig removed: both moneylines are
 * converted to implied probabilities, then normalized to sum to 1. Null if either
 * line is missing or invalid.
 */
export function impliedHomeProbability(market: MarketReference): number | null {
  if (market.homeMoneyline === null || market.awayMoneyline === null) return null;
  const home = moneylineProbability(market.homeMoneyline);
  const away = moneylineProbability(market.awayMoneyline);
  if (home === null || away === null) return null;
  const total = home + away;
  if (!(total > 0)) return null;
  return Math.min(1, Math.max(0, home / total));
}

/** Display names for sportsbooks ESPN spells more than one way, keyed by a squashed form. */
const PROVIDER_NAMES: Record<string, string> = {
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  betmgm: "BetMGM",
  caesars: "Caesars",
  espnbet: "ESPN BET",
};

/** One display name per sportsbook: ESPN sends both "DraftKings" and "Draft Kings". */
export function providerName(provider: string): string {
  const key = provider.toLowerCase().replace(/[^a-z]/g, "");
  return PROVIDER_NAMES[key] ?? provider.trim();
}
