import {
  predictLogistic,
  type LogisticModel,
} from "./regression";

export function seriesProbabilityChallenger(
  rawSeriesProbabilityA: number,
  seedDifference: number,
  model: LogisticModel,
): number {
  if (
    !Number.isFinite(rawSeriesProbabilityA) ||
    rawSeriesProbabilityA < 0 ||
    rawSeriesProbabilityA > 1
  ) {
    throw new Error("Raw series probability must be finite and within [0, 1].");
  }
  if (!Number.isFinite(seedDifference)) {
    throw new Error("Seed difference must be finite.");
  }
  const bounded = Math.min(
    1 - 1e-6,
    Math.max(1e-6, rawSeriesProbabilityA),
  );
  const probability = predictLogistic(
    model,
    [Math.log(bounded / (1 - bounded)), seedDifference],
  );
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error("Registered challenger produced an invalid probability.");
  }
  return probability;
}
