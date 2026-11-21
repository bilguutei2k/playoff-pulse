import { describe, expect, it } from "vitest";
import type { ShadowV4View } from "@/lib/live-data/published";
import { shadowV4Lines } from "@/lib/view/shadow-v4";

const NONE = { brier: null, logLoss: null };

function view(scored: number, same = 0): ShadowV4View {
  return {
    modelVersion: "live-2026.27-v4",
    firstEtDate: "2026-11-21",
    slate: "2026-11-24",
    record: { sealed: scored + 5, scored, pending: 5, missed: 0, brier: scored ? 0.21234 : null, logLoss: scored ? 0.6123 : null },
    sameGames: same
      ? { games: same, v4: { brier: 0.2101, logLoss: 0.6 }, v2: { brier: 0.2202, logLoss: 0.62 }, v1: { brier: 0.2303, logLoss: 0.64 } }
      : { games: 0, v4: NONE, v2: NONE, v1: NONE },
    impact: {},
  };
}

describe("the /record section for v4 in testing", () => {
  it("renders nothing without a shadow file or before v4's first seal date is set", () => {
    expect(shadowV4Lines(null, "2026-11-21")).toBeNull();
    expect(shadowV4Lines(view(3, 3), null)).toBeNull();
  });

  it("says when sealing began and that nothing is scored yet", () => {
    const lines = shadowV4Lines(view(0), "2026-11-21")!;
    expect(lines.heading).toBe("In testing: roster-state model v4");
    expect(lines.lead).toBe("Sealing since Nov 21; no scored games yet. Not the published forecast.");
    expect(lines.scored).toBeNull();
    expect(lines.sameGames).toBeNull();
  });

  it("shows a few scored games with the small-sample label and plain same-games lines", () => {
    const lines = shadowV4Lines(view(12, 11), "2026-11-21")!;
    expect(lines.lead).toBe("Sealing since Nov 21. Not the published forecast.");
    expect(lines.scored).toEqual({
      games: 12,
      brier: "0.212",
      logLoss: "0.612",
      smallSample: "Small sample: 12 scored games. Below 500, results say little about skill.",
    });
    expect(lines.sameGames).toEqual({
      games: 11,
      rows: [
        { label: "v4", brier: "0.210", logLoss: "0.600" },
        { label: "v2", brier: "0.220", logLoss: "0.620" },
        { label: "v1", brier: "0.230", logLoss: "0.640" },
      ],
    });
  });

  it("drops the small-sample label at 500 scored games and the same-games lines when there are none", () => {
    const lines = shadowV4Lines(view(500), "2026-11-21")!;
    expect(lines.scored?.smallSample).toBeNull();
    expect(lines.sameGames).toBeNull();
  });

  it("never words a comparison", () => {
    const text = JSON.stringify(shadowV4Lines(view(12, 11), "2026-11-21"));
    expect(text).not.toMatch(/better|more accurate|beats|outperform|ahead/i);
  });
});
