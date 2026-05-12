import type { MarketOdds } from "@/lib/model/types";

export function americanOddsToImpliedProbability(moneyline: number): number {
  if (moneyline < 0) {
    return Math.abs(moneyline) / (Math.abs(moneyline) + 100);
  }

  return 100 / (moneyline + 100);
}

export function getActiveMarketOdds(marketOdds: MarketOdds[]): MarketOdds[] {
  return marketOdds.filter((odds) => !odds.isPlaceholder);
}
