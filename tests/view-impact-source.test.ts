import { describe, expect, it } from "vitest";
import { LIVE_MODEL_VERSION, REFERENCE_MODEL_VERSION } from "@/lib/season/params";
import { V4_MODEL_VERSION } from "@/lib/season/params-v4";
import { impactSource } from "@/lib/view/impact-source";

describe("impactSource (registration-v4.md, W5)", () => {
  it("is v4 only when v4 is the published model", () => {
    expect(V4_MODEL_VERSION).toBe("live-2026.27-v4");
    expect(impactSource(V4_MODEL_VERSION)).toBe("v4");
  });

  it("stays Game Score for every other published version, today's v2 included", () => {
    expect(impactSource(LIVE_MODEL_VERSION)).toBe("game-score");
    expect(impactSource(REFERENCE_MODEL_VERSION)).toBe("game-score");
    expect(impactSource("live-2026.27-v3")).toBe("game-score");
    expect(impactSource("")).toBe("game-score");
  });
});
