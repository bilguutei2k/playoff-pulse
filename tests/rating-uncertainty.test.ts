import { describe, expect, it } from "vitest";

import { fitRatingUncertaintyStandardDeviation } from "../scripts/backtest/research-model";

describe("rating uncertainty fitting", () => {
  it("uses only seasons strictly before the target season", () => {
    const snapshots = [
      { season: 2023, srs: 4, netRating: 3 },
      { season: 2024, srs: 1, netRating: 3 },
      { season: 2025, srs: 2, netRating: 2.5 },
    ];
    expect(fitRatingUncertaintyStandardDeviation(snapshots, 2026)).toBeCloseTo(
      1.5,
      12,
    );
  });

  it("rejects a target-season row instead of silently filtering it", () => {
    expect(() =>
      fitRatingUncertaintyStandardDeviation(
        [
          { season: 2025, srs: 1, netRating: 0 },
          { season: 2026, srs: 2, netRating: 1 },
        ],
        2026,
      ),
    ).toThrow(/received a row from 2026 or later/);
  });

  it("fails closed without enough prior-season rows", () => {
    expect(() =>
      fitRatingUncertaintyStandardDeviation(
        [{ season: 2025, srs: 1, netRating: 0 }],
        2026,
      ),
    ).toThrow(/at least two prior rows/);
  });
});
