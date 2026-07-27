export function ratingGapPlayerMultiplier(
  srsDifference: number,
  decayScaleSrsPoints: number,
): number {
  if (!Number.isFinite(srsDifference)) {
    throw new Error("SRS difference must be finite.");
  }
  if (
    !Number.isFinite(decayScaleSrsPoints) ||
    decayScaleSrsPoints <= 0
  ) {
    throw new Error("Rating-gap decay scale must be finite and positive.");
  }
  return Math.exp(-Math.abs(srsDifference) / decayScaleSrsPoints);
}

