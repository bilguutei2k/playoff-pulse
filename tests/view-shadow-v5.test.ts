import { describe, expect, it } from "vitest";
import type { ShadowV5View } from "@/lib/live-data/published";
import { shadowV5Lines } from "@/lib/view/shadow-v5";

const NONE = { brier: null, logLoss: null };

function view(scored: number, same = 0, lastEtDate: string | null = null): ShadowV5View {
  return {
    modelVersion: "live-2026.27-v5",
    firstEtDate: "2026-11-25",
    lastEtDate,
    slate: "2026-11-28",
    record: { sealed: scored + 5, scored, pending: 5, missed: 0, brier: scored ? 0.21234 : null, logLoss: scored ? 0.6123 : null },
    sameGames: same
      ? {
          games: same,
          v5: { brier: 0.2101, logLoss: 0.6 },
          v4: { brier: 0.2202, logLoss: 0.62 },
          v2: { brier: 0.2303, logLoss: 0.64 },
          v1: { brier: 0.2404, logLoss: 0.66 },
        }
      : { games: 0, v5: NONE, v4: NONE, v2: NONE, v1: NONE },
  };
}

describe("the /record section for v5 in testing", () => {
  it("renders nothing without a shadow file or before v5's first seal date is set", () => {
    expect(shadowV5Lines(null, "2026-11-25")).toBeNull();
    expect(shadowV5Lines(view(3, 3), null)).toBeNull();
  });

  it("says when sealing began and that nothing is scored yet", () => {
    const lines = shadowV5Lines(view(0), "2026-11-25")!;
    expect(lines.heading).toBe("In testing: model v5 (v4 plus an on-court observation)");
    expect(lines.lead).toBe("Sealing since Nov 25; no scored games yet. Not the published forecast.");
    expect(lines.scored).toBeNull();
    expect(lines.sameGames).toBeNull();
  });

  it("shows its record with the small-sample label and the four same-games lines in fixed order", () => {
    const lines = shadowV5Lines(view(12, 10), "2026-11-25")!;
    expect(lines.lead).toBe("Sealing since Nov 25. Not the published forecast.");
    expect(lines.scored).toEqual({ games: 12, brier: "0.212", logLoss: "0.612", smallSample: expect.stringContaining("12") });
    expect(lines.sameGames?.games).toBe(10);
    expect(lines.sameGames?.rows.map((row) => row.label)).toEqual(["v5", "v4", "v2", "v1"]);
    expect(lines.sameGames?.rows.map((row) => row.brier)).toEqual(["0.210", "0.220", "0.230", "0.240"]);
  });

  it("names both dates once the stop switch is set", () => {
    expect(shadowV5Lines(view(12, 0, "2026-12-20"), "2026-11-25")!.lead).toBe(
      "Sealed from Nov 25 to Dec 20, then stopped. Not the published forecast.",
    );
  });
});
