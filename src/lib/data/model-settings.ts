import type { ModelSettings } from "@/lib/model/types";

export const defaultModelSettings: ModelSettings = {
  playerWeight: 0.55,
  netRatingWeight: 0.25,
  eloWeight: 0.2,
  homeCourtAdvantage: 2.2,
  logisticScale: 6.5,
  simulationIterations: 10000,
};
